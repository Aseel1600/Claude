package translator

import (
	"encoding/json"
	"time"
)

func init() {
	registerRequestTranslator(FormatGemini, FormatOpenAI, geminiToOpenAIRequest)
}

// geminiToOpenAIRequest translates a Gemini API request body into
// OpenAI chat completions format.
func geminiToOpenAIRequest(model string, body map[string]any) map[string]any {
	result := map[string]any{
		"model":    model,
		"messages": []any{},
		"stream":   body["stream"],
	}

	// Generation config
	if genConfig, ok := body["generationConfig"].(map[string]any); ok {
		if mot, ok := genConfig["maxOutputTokens"]; ok {
			tempBody := map[string]any{"max_tokens": mot}
			result["max_tokens"] = adjustMaxTokens(tempBody)
		}
		if temp, ok := genConfig["temperature"]; ok {
			result["temperature"] = temp
		}
		if topP, ok := genConfig["topP"]; ok {
			result["top_p"] = topP
		}
	}

	// System instruction
	if si, ok := body["systemInstruction"].(map[string]any); ok {
		systemText := extractGeminiText(si)
		if systemText != "" {
			result["messages"] = append(result["messages"].([]any), map[string]any{
				"role":    "system",
				"content": systemText,
			})
		}
	}

	// Convert contents to messages
	if contents, ok := body["contents"].([]any); ok {
		splitContents := splitCoLocatedFunctionResponses(contents)
		for _, content := range splitContents {
			cm, ok := content.(map[string]any)
			if !ok {
				continue
			}
			converted := convertGeminiContentWithReasoning(cm)
			if converted != nil {
				result["messages"] = append(result["messages"].([]any), converted)
			}
		}
	}

	// Tools
	if bodyTools, ok := body["tools"].([]any); ok {
		var openaiTools []any
		for _, tool := range bodyTools {
			toolMap, ok := tool.(map[string]any)
			if !ok {
				continue
			}
			if decls, ok := toolMap["functionDeclarations"].([]any); ok {
				for _, decl := range decls {
					declMap, ok := decl.(map[string]any)
					if !ok {
						continue
					}
					name, _ := declMap["name"].(string)
					desc, _ := declMap["description"].(string)
					params := declMap["parameters"]
					if params == nil {
						params = map[string]any{"type": "object", "properties": map[string]any{}}
					}
					openaiTools = append(openaiTools, map[string]any{
						"type": "function",
						"function": map[string]any{
							"name":        name,
							"description": desc,
							"parameters":  params,
						},
					})
				}
			}
		}
		if len(openaiTools) > 0 {
			result["tools"] = openaiTools
		}
	}

	return result
}

// splitCoLocatedFunctionResponses splits Gemini contents that mix functionResponse
// with other parts into separate entries.
func splitCoLocatedFunctionResponses(contents []any) []any {
	var out []any
	for _, content := range contents {
		cm, ok := content.(map[string]any)
		if !ok {
			out = append(out, content)
			continue
		}
		parts, ok := cm["parts"].([]any)
		if !ok {
			out = append(out, content)
			continue
		}

		hasFR := false
		for _, p := range parts {
			pm, ok := p.(map[string]any)
			if ok && pm["functionResponse"] != nil {
				hasFR = true
				break
			}
		}
		if !hasFR {
			out = append(out, content)
			continue
		}

		for _, p := range parts {
			pm, ok := p.(map[string]any)
			if ok && pm["functionResponse"] != nil {
				out = append(out, map[string]any{
					"role":  cm["role"],
					"parts": []any{p},
				})
			}
		}

		// Non-functionResponse parts
		var nonFRParts []any
		for _, p := range parts {
			pm, ok := p.(map[string]any)
			if !ok || pm["functionResponse"] == nil {
				nonFRParts = append(nonFRParts, p)
			}
		}
		if len(nonFRParts) > 0 {
			out = append(out, map[string]any{
				"role":  cm["role"],
				"parts": nonFRParts,
			})
		}
	}
	return out
}

// convertGeminiContentWithReasoning extracts thought parts and re-attaches
// them as reasoning_content on the resulting message.
func convertGeminiContentWithReasoning(content map[string]any) any {
	if content == nil || content["parts"] == nil {
		return nil
	}
	parts, ok := content["parts"].([]any)
	if !ok {
		return convertGeminiContent(content)
	}

	var reasoningContent string
	var visibleParts []any
	for _, p := range parts {
		pm, ok := p.(map[string]any)
		if !ok {
			visibleParts = append(visibleParts, p)
			continue
		}
		if thought, ok := pm["thought"].(bool); ok && thought {
			if text, ok := pm["text"].(string); ok {
				reasoningContent += text
			}
		} else {
			visibleParts = append(visibleParts, p)
		}
	}

	if reasoningContent == "" {
		return convertGeminiContent(content)
	}

	visible := make(map[string]any, len(content))
	for k, v := range content {
		visible[k] = v
	}
	visible["parts"] = visibleParts

	converted := convertGeminiContent(visible)
	if converted == nil {
		return nil
	}
	if cm, ok := converted.(map[string]any); ok {
		if cm["role"] != "tool" {
			cm["reasoning_content"] = reasoningContent
			return cm
		}
	}

	return converted
}

func convertGeminiContent(content map[string]any) any {
	if content == nil {
		return nil
	}
	role, _ := content["role"].(string)
	mappedRole := "assistant"
	if role == "user" {
		mappedRole = "user"
	}

	parts, ok := content["parts"].([]any)
	if !ok {
		return nil
	}

	var textParts []any
	var toolCalls []any

	for _, p := range parts {
		pm, ok := p.(map[string]any)
		if !ok {
			continue
		}

		if text, ok := pm["text"].(string); ok && text != "" {
			textParts = append(textParts, map[string]any{"type": "text", "text": text})
		}

		// Inline data → image
		if inlineData, ok := pm["inlineData"].(map[string]any); ok {
			mimeType, _ := inlineData["mimeType"].(string)
			data, _ := inlineData["data"].(string)
			if mimeType == "" {
				mimeType = "image/png"
			}
			textParts = append(textParts, map[string]any{
				"type": "image_url",
				"image_url": map[string]any{
					"url": "data:" + mimeType + ";base64," + data,
				},
			})
		}

		// functionCall → tool_call
		if fc, ok := pm["functionCall"].(map[string]any); ok {
			fnName, _ := fc["name"].(string)
			args := fc["args"]
			argsStr, _ := json.Marshal(args)
			id := "call_" + time.Now().Format("0102150405.000000000")
			toolCalls = append(toolCalls, map[string]any{
				"id":   id,
				"type": "function",
				"function": map[string]any{
					"name":      fnName,
					"arguments": string(argsStr),
				},
			})
		}

		// functionResponse → tool message (early return)
		if fr, ok := pm["functionResponse"].(map[string]any); ok {
			frName, _ := fr["name"].(string)
			frID, _ := fr["id"].(string)
			if frID == "" {
				frID = frName
			}
			respObj, _ := fr["response"].(map[string]any)
			var respContent string
			if respObj != nil {
				if result, ok := respObj["result"]; ok {
					b, _ := json.Marshal(result)
					respContent = string(b)
				}
			}
			if respContent == "" {
				b, _ := json.Marshal(fr["response"])
				respContent = string(b)
			}
			return map[string]any{
				"role":         "tool",
				"tool_call_id": frID,
				"content":      respContent,
			}
		}
	}

	if len(toolCalls) > 0 {
		result := map[string]any{"role": "assistant"}
		if len(textParts) > 0 {
			if len(textParts) == 1 {
				if p, ok := textParts[0].(map[string]any); ok {
					result["content"] = p["text"]
				}
			} else {
				result["content"] = textParts
			}
		}
		result["tool_calls"] = toolCalls
		return result
	}

	if len(textParts) > 0 {
		if len(textParts) == 1 {
			if p, ok := textParts[0].(map[string]any); ok {
				if t, ok := p["text"].(string); ok {
					return map[string]any{"role": mappedRole, "content": t}
				}
			}
		}
		return map[string]any{"role": mappedRole, "content": textParts}
	}

	return nil
}

func extractGeminiText(content any) string {
	switch c := content.(type) {
	case string:
		return c
	case map[string]any:
		if parts, ok := c["parts"].([]any); ok {
			var texts []string
			for _, p := range parts {
				pm, ok := p.(map[string]any)
				if !ok {
					continue
				}
				if text, ok := pm["text"].(string); ok {
					texts = append(texts, text)
				}
			}
			return joinStrings(texts)
		}
	}
	return ""
}

func joinStrings(ss []string) string {
	total := 0
	for _, s := range ss {
		total += len(s)
	}
	buf := make([]byte, 0, total)
	for i, s := range ss {
		if i > 0 {
			buf = append(buf, '\n')
		}
		buf = append(buf, s...)
	}
	return string(buf)
}
