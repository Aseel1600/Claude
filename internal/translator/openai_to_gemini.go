package translator

import (
	"encoding/json"
	"strings"
)

func init() {
	registerRequestTranslator(FormatOpenAI, FormatGemini, openaiToGeminiRequest)
}

// openaiToGeminiRequest translates an OpenAI-format request body into
// Google Gemini API format.
func openaiToGeminiRequest(model string, body map[string]any) map[string]any {
	result := map[string]any{
		"model":              model,
		"contents":           []any{},
		"generationConfig":   map[string]any{},
		"safetySettings":     defaultSafetySettings(),
	}

	genConfig := result["generationConfig"].(map[string]any)

	// Generation config
	if temp, ok := body["temperature"]; ok {
		genConfig["temperature"] = temp
	}
	if topP, ok := body["top_p"]; ok {
		genConfig["topP"] = topP
	}
	if topK, ok := body["top_k"]; ok {
		genConfig["topK"] = topK
	}
	if stop, ok := body["stop"]; ok {
		if arr, ok := stop.([]any); ok {
			genConfig["stopSequences"] = arr
		} else {
			genConfig["stopSequences"] = []any{stop}
		}
	}
	// max_tokens / max_completion_tokens → maxOutputTokens
	if mt, ok := body["max_tokens"]; ok {
		genConfig["maxOutputTokens"] = toFloat64(mt)
	} else if mct, ok := body["max_completion_tokens"]; ok {
		genConfig["maxOutputTokens"] = toFloat64(mct)
	}

	// Thinking / Reasoning support
	modelLower := strings.ToLower(model)
	if !strings.HasPrefix(modelLower, "gemma-4") {
		if effort, ok := body["reasoning_effort"].(string); ok {
			budget := effortToThinkingBudget(effort, model)
			genConfig["thinkingConfig"] = map[string]any{
				"thinkingBudget": budget,
				"includeThoughts": budget != 0,
			}
		}
		if thinking, ok := body["thinking"].(map[string]any); ok {
			if thinking["type"] == "enabled" {
				if bt, ok := thinking["budget_tokens"]; ok {
					budget := toFloat64(bt)
					genConfig["thinkingConfig"] = map[string]any{
						"thinkingBudget":  budget,
						"includeThoughts": budget != 0,
					}
				}
			}
		}

		// Default: modern Gemini models (2.5+) support thinking
		if _, hasThinking := genConfig["thinkingConfig"]; !hasThinking {
			if strings.Contains(modelLower, "gemini") &&
				!strings.Contains(modelLower, "gemini-1") &&
				(!strings.Contains(modelLower, "gemini-2.0") || strings.Contains(modelLower, "thinking")) {
				genConfig["thinkingConfig"] = map[string]any{
					"thinkingBudget":  24576,
					"includeThoughts": true,
				}
			}
		}
	}

	// Build tool_call_id → name map
	tcID2Name := map[string]string{}
	toolResponses := map[string]any{}
	var messages []any
	if msgs, ok := body["messages"].([]any); ok {
		messages = msgs
		for _, msg := range messages {
			msgMap, ok := msg.(map[string]any)
			if !ok {
				continue
			}
			role, _ := msgMap["role"].(string)
			if role == "assistant" {
				if tcs, ok := msgMap["tool_calls"].([]any); ok {
					for _, tc := range tcs {
						tcMap, ok := tc.(map[string]any)
						if !ok {
							continue
						}
						if tcMap["type"] != "function" {
							continue
						}
						id, _ := tcMap["id"].(string)
						fn, ok := tcMap["function"].(map[string]any)
						if !ok {
							continue
						}
						name, _ := fn["name"].(string)
						if id != "" && name != "" {
							tcID2Name[id] = name
						}
					}
				}
			}
			if role == "tool" {
				if tcid, ok := msgMap["tool_call_id"].(string); ok {
					toolResponses[tcid] = msgMap["content"]
				}
			}
		}
	}

	// Convert messages to contents
	var contents []any
	for _, msg := range messages {
		msgMap, ok := msg.(map[string]any)
		if !ok {
			continue
		}
		role, _ := msgMap["role"].(string)
		content := msgMap["content"]

		switch role {
		case "system":
			if len(messages) > 1 {
				systemText := normalizeContentToString(content)
				if systemText != "" {
					si, _ := result["systemInstruction"].(map[string]any)
					if si == nil {
						si = map[string]any{
							"role":  "system",
							"parts": []any{map[string]any{"text": systemText}},
						}
						result["systemInstruction"] = si
					} else {
						parts, _ := si["parts"].([]any)
						parts = append(parts, map[string]any{"text": systemText})
						si["parts"] = parts
					}
				}
			} else {
				// Single system message → treat as user content
				parts := convertOpenAIContentToParts(content)
				if len(parts) > 0 {
					contents = append(contents, map[string]any{"role": "user", "parts": parts})
				}
			}

		case "user":
			parts := convertOpenAIContentToParts(content)
			if len(parts) > 0 {
				contents = append(contents, map[string]any{"role": "user", "parts": parts})
			}

		case "assistant":
			var parts []any

			// reasoning_content → thought part
			if rc, ok := msgMap["reasoning_content"].(string); ok && rc != "" {
				parts = append(parts, map[string]any{
					"thought": true,
					"text":    rc,
				})
			}

			// Content text
			if content != nil {
				text := normalizeContentToString(content)
				if text != "" {
					parts = append(parts, map[string]any{"text": text})
				}
			}

			// Tool calls → functionCall parts
			if tcs, ok := msgMap["tool_calls"].([]any); ok {
				for _, tc := range tcs {
					tcMap, ok := tc.(map[string]any)
					if !ok || tcMap["type"] != "function" {
						continue
					}
					fn, ok := tcMap["function"].(map[string]any)
					if !ok {
						continue
					}
					fnName, _ := fn["name"].(string)
					argsStr, _ := fn["arguments"].(string)
					var args map[string]any
					if argsStr != "" {
						if err := json.Unmarshal([]byte(argsStr), &args); err != nil {
							args = map[string]any{}
						}
					} else {
						args = map[string]any{}
					}
					parts = append(parts, map[string]any{
						"functionCall": map[string]any{
							"name": fnName,
							"args": args,
						},
					})
				}

				// Emit model message with function calls, then user message with responses
				if len(parts) > 0 {
					contents = append(contents, map[string]any{"role": "model", "parts": parts})
				}

				// Collect tool responses for the tool calls
				var toolParts []any
				for _, tc := range tcs {
					tcMap, ok := tc.(map[string]any)
					if !ok || tcMap["type"] != "function" {
						continue
					}
					id, _ := tcMap["id"].(string)
					fn, ok := tcMap["function"].(map[string]any)
					if !ok {
						continue
					}
					fnName, _ := fn["name"].(string)

					resp, hasResp := toolResponses[id]
					if !hasResp {
						continue
					}

					var parsedResp any
					switch r := resp.(type) {
					case string:
						if err := json.Unmarshal([]byte(r), &parsedResp); err != nil {
							parsedResp = map[string]any{"result": r}
						}
					default:
						parsedResp = resp
					}
					if _, isObj := parsedResp.(map[string]any); !isObj {
						parsedResp = map[string]any{"result": parsedResp}
					}

					toolParts = append(toolParts, map[string]any{
						"functionResponse": map[string]any{
							"name": fnName,
							"response": map[string]any{
								"result": parsedResp,
							},
						},
					})
				}
				if len(toolParts) > 0 {
					contents = append(contents, map[string]any{"role": "user", "parts": toolParts})
				}
			} else if len(parts) > 0 {
				contents = append(contents, map[string]any{"role": "model", "parts": parts})
			}
		}
	}

	// Merge consecutive same-role contents (Gemini rejects them)
	contents = mergeConsecutiveSameRoleContents(contents)
	result["contents"] = contents

	// Convert tools
	if bodyTools, ok := body["tools"].([]any); ok {
		var functionDecls []any
		hasGoogleSearch := false
		for _, tool := range bodyTools {
			toolMap, ok := tool.(map[string]any)
			if !ok {
				continue
			}
			fn, ok := toolMap["function"].(map[string]any)
			if !ok {
				continue
			}
			name, _ := fn["name"].(string)
			desc, _ := fn["description"].(string)

			if name == "google_search" || name == "googleSearch" {
				hasGoogleSearch = true
				continue
			}

			params, _ := fn["parameters"]
			if params == nil {
				params = map[string]any{"type": "object", "properties": map[string]any{}}
			}

			functionDecls = append(functionDecls, map[string]any{
				"name":        name,
				"description": desc,
				"parameters":  params,
			})
		}

		var tools []any
		if len(functionDecls) > 0 {
			tools = append(tools, map[string]any{"functionDeclarations": functionDecls})
		}
		if hasGoogleSearch {
			tools = append(tools, map[string]any{"googleSearch": map[string]any{}})
		}
		if len(tools) > 0 {
			result["tools"] = tools
			result["toolConfig"] = map[string]any{
				"functionCallingConfig": convertOpenAIToolChoiceToGemini(body["tool_choice"]),
			}
		}
	}

	// Response format
	if rf, ok := body["response_format"].(map[string]any); ok {
		rfType, _ := rf["type"].(string)
		switch rfType {
		case "json_schema":
			genConfig["responseMimeType"] = "application/json"
			if schema, ok := rf["json_schema"].(map[string]any); ok {
				if s, ok := schema["schema"]; ok {
					genConfig["responseSchema"] = s
				}
			}
		case "json_object":
			genConfig["responseMimeType"] = "application/json"
		case "text":
			genConfig["responseMimeType"] = "text/plain"
		}
	}

	// Deep clean undefined values
	deepCleanUndefined(result)

	return result
}

func defaultSafetySettings() []any {
	return []any{
		map[string]any{"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
		map[string]any{"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
		map[string]any{"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
		map[string]any{"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
	}
}

func effortToThinkingBudget(effort string, model string) int {
	switch strings.ToLower(effort) {
	case "none":
		return 0
	case "low":
		return 1024
	case "medium":
		return 8192
	case "high", "auto", "max", "xhigh":
		return 32768
	default:
		return 8192
	}
}

func convertOpenAIContentToParts(content any) []any {
	switch c := content.(type) {
	case string:
		if c != "" {
			return []any{map[string]any{"text": c}}
		}
	case []any:
		var parts []any
		for _, p := range c {
			pm, ok := p.(map[string]any)
			if !ok {
				continue
			}
			ptype, _ := pm["type"].(string)
			switch ptype {
			case "text":
				if text, ok := pm["text"].(string); ok && text != "" {
					parts = append(parts, map[string]any{"text": text})
				}
			case "image_url":
				if imgURL, ok := pm["image_url"].(map[string]any); ok {
					if url, ok := imgURL["url"].(string); ok {
						if idx := strings.Index(url, "base64,"); idx > 0 {
							mediaType := url[len("data:"):idx]
							data := url[idx+len("base64,"):]
							parts = append(parts, map[string]any{
								"inlineData": map[string]any{
									"mimeType": mediaType,
									"data":     data,
								},
							})
						}
					}
				}
			}
		}
		return parts
	}
	return nil
}

func convertOpenAIToolChoiceToGemini(choice any) map[string]any {
	if choice == nil {
		return map[string]any{"mode": "VALIDATED"}
	}
	switch c := choice.(type) {
	case string:
		switch c {
		case "none":
			return map[string]any{"mode": "NONE"}
		case "required", "any":
			return map[string]any{"mode": "ANY"}
		default:
			return map[string]any{"mode": "VALIDATED"}
		}
	case map[string]any:
		t, _ := c["type"].(string)
		switch t {
		case "function":
			if fn, ok := c["function"].(map[string]any); ok {
				if name, ok := fn["name"].(string); ok {
					return map[string]any{"mode": "ANY", "allowedFunctionNames": []any{name}}
				}
			}
		case "none":
			return map[string]any{"mode": "NONE"}
		case "required", "any":
			return map[string]any{"mode": "ANY"}
		}
		return map[string]any{"mode": "VALIDATED"}
	}
	return map[string]any{"mode": "VALIDATED"}
}

func mergeConsecutiveSameRoleContents(contents []any) []any {
	if len(contents) == 0 {
		return contents
	}
	var merged []any
	for _, entry := range contents {
		em, ok := entry.(map[string]any)
		if !ok {
			merged = append(merged, entry)
			continue
		}
		role, _ := em["role"].(string)
		parts, _ := em["parts"].([]any)

		if len(merged) > 0 {
			last, ok := merged[len(merged)-1].(map[string]any)
			if ok {
				lastRole, _ := last["role"].(string)
				if lastRole == role {
					lastParts, _ := last["parts"].([]any)
					last["parts"] = append(lastParts, parts...)
					continue
				}
			}
		}

		// Shallow copy
		entryCopy := make(map[string]any, len(em))
		for k, v := range em {
			entryCopy[k] = v
		}
		partsCopy := make([]any, len(parts))
		copy(partsCopy, parts)
		entryCopy["parts"] = partsCopy
		merged = append(merged, entryCopy)
	}
	return merged
}

func deepCleanUndefined(m map[string]any) {
	for k, v := range m {
		if v == nil {
			delete(m, k)
			continue
		}
		if sub, ok := v.(map[string]any); ok {
			deepCleanUndefined(sub)
			if len(sub) == 0 {
				delete(m, k)
			}
		}
	}
}

func toFloat64(v any) any {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case json.Number:
		f, _ := n.Float64()
		return f
	default:
		return v
	}
}
