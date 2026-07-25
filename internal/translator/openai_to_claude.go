package translator

import (
	"encoding/json"
	"strings"
)

const (
	claudeToolChoiceRequired = "any"
)

func init() {
	registerRequestTranslator(FormatOpenAI, FormatClaude, openaiToClaudeRequest)
}

// openaiToClaudeRequest translates an OpenAI-format request body into
// Claude's Messages API format.
func openaiToClaudeRequest(model string, body map[string]any) map[string]any {
	result := map[string]any{
		"model":      model,
		"max_tokens": adjustMaxTokens(body),
		"stream":     body["stream"],
		"messages":   []any{},
	}

	// Temperature — Claude rejects temperature when extended thinking is active
	modelForcesThinking := strings.Contains(model, "claude-opus-4") || strings.Contains(model, "claude-sonnet-4")
	if temp, ok := body["temperature"]; ok && !modelForcesThinking {
		result["temperature"] = temp
	}
	if _, hasTemp := body["temperature"]; !hasTemp {
		if topP, ok := body["top_p"]; ok {
			result["top_p"] = topP
		}
	}
	if stop, ok := body["stop"]; ok {
		if stopArr, ok := stop.([]any); ok {
			result["stop_sequences"] = stopArr
		} else {
			result["stop_sequences"] = []any{stop}
		}
	}

	// Thinking configuration
	if thinking, ok := body["thinking"].(map[string]any); ok {
		thinkingCopy := make(map[string]any, len(thinking))
		for k, v := range thinking {
			thinkingCopy[k] = v
		}
		if _, ok := thinkingCopy["type"]; !ok {
			thinkingCopy["type"] = "enabled"
		}
		result["thinking"] = thinkingCopy
	} else if effort, ok := body["reasoning_effort"].(string); ok {
		effort = strings.ToLower(effort)
		effortBudgetMap := map[string]int{
			"low":    1024,
			"medium": 10240,
			"high":   131072,
			"max":    131072,
		}
		if budget, ok := effortBudgetMap[effort]; ok {
			result["thinking"] = map[string]any{
				"type":          "enabled",
				"budget_tokens": budget,
			}
		}
	}

	// Strip temperature if thinking is enabled
	if _, hasThinking := result["thinking"]; hasThinking {
		delete(result, "temperature")
	}

	// Process messages
	systemParts := []string{}
	var messages []any

	msgs, _ := body["messages"].([]any)
	// Filter system/developer messages
	var nonSystemMessages []any
	for _, msg := range msgs {
		msgMap, ok := msg.(map[string]any)
		if !ok {
			continue
		}
		role, _ := msgMap["role"].(string)
		if role == "system" || role == "developer" {
			text := normalizeContentToString(msgMap["content"])
			if text != "" {
				systemParts = append(systemParts, text)
			}
			continue
		}
		nonSystemMessages = append(nonSystemMessages, msg)
	}

	// Convert non-system messages
	var currentRole string
	var currentParts []any

	flushCurrent := func() {
		if currentRole != "" && len(currentParts) > 0 {
			messages = append(messages, map[string]any{
				"role":    currentRole,
				"content": currentParts,
			})
			currentParts = nil
		}
	}

	for _, msg := range nonSystemMessages {
		msgMap, ok := msg.(map[string]any)
		if !ok {
			continue
		}
		role, _ := msgMap["role"].(string)
		newRole := role
		if role == "user" || role == "tool" {
			newRole = "user"
		} else {
			newRole = "assistant"
		}

		blocks := getContentBlocksFromMessage(msgMap)

		hasToolResult := false
		for _, b := range blocks {
			if bm, ok := b.(map[string]any); ok {
				if bm["type"] == "tool_result" {
					hasToolResult = true
					break
				}
			}
		}

		if hasToolResult {
			var toolResultBlocks, otherBlocks []any
			for _, b := range blocks {
				if bm, ok := b.(map[string]any); ok && bm["type"] == "tool_result" {
					toolResultBlocks = append(toolResultBlocks, b)
				} else {
					otherBlocks = append(otherBlocks, b)
				}
			}
			flushCurrent()
			if len(toolResultBlocks) > 0 {
				messages = append(messages, map[string]any{
					"role":    "user",
					"content": toolResultBlocks,
				})
			}
			if len(otherBlocks) > 0 {
				currentRole = newRole
				currentParts = append(currentParts, otherBlocks...)
			}
			continue
		}

		if currentRole != newRole {
			flushCurrent()
			currentRole = newRole
		}
		currentParts = append(currentParts, blocks...)

		hasToolUse := false
		for _, b := range blocks {
			if bm, ok := b.(map[string]any); ok {
				if bm["type"] == "tool_use" {
					hasToolUse = true
					break
				}
			}
		}
		if hasToolUse {
			flushCurrent()
		}
	}
	flushCurrent()

	// Remove empty assistant messages
	var filteredMessages []any
	for _, msg := range messages {
		msgMap, ok := msg.(map[string]any)
		if !ok {
			filteredMessages = append(filteredMessages, msg)
			continue
		}
		if msgMap["role"] == "assistant" {
			if contentArr, ok := msgMap["content"].([]any); ok && len(contentArr) == 0 {
				continue
			}
		}
		filteredMessages = append(filteredMessages, msg)
	}
	messages = filteredMessages

	// Enforce tool result adjacency (each tool_result must follow the assistant turn)
	messages = enforceToolResultAdjacency(messages)

	// Add cache_control to last assistant message
	for i := len(messages) - 1; i >= 0; i-- {
		msgMap, ok := messages[i].(map[string]any)
		if !ok {
			continue
		}
		if msgMap["role"] != "assistant" {
			continue
		}
		contentArr, ok := msgMap["content"].([]any)
		if !ok || len(contentArr) == 0 {
			continue
		}
		lastBlock, ok := contentArr[len(contentArr)-1].(map[string]any)
		if ok {
			lastBlock["cache_control"] = map[string]any{"type": "ephemeral"}
		}
		break
	}

	result["messages"] = messages

	// Tools
	toolNameMap := map[string]string{}
	if bodyTools, ok := body["tools"].([]any); ok {
		var claudeTools []any
		for _, tool := range bodyTools {
			toolMap, ok := tool.(map[string]any)
			if !ok {
				continue
			}
			toolData := toolMap
			if fn, ok := toolMap["function"].(map[string]any); ok {
				toolData = fn
			}

			originalName := ""
			if name, ok := toolData["name"].(string); ok {
				originalName = strings.TrimSpace(name)
			}
			if originalName == "" {
				continue
			}

			// Normalize input_schema
			rawSchema, _ := toolData["parameters"].(map[string]any)
			if rawSchema == nil {
				rawSchema, _ = toolData["input_schema"].(map[string]any)
			}
			if rawSchema == nil {
				rawSchema = map[string]any{"type": "object", "properties": map[string]any{}, "required": []any{}}
			}
			if rawSchema["type"] == "object" && rawSchema["properties"] == nil {
				rawSchema["properties"] = map[string]any{}
			}

			desc, _ := toolData["description"].(string)

			claudeTool := map[string]any{
				"name":         originalName,
				"description":  desc,
				"input_schema": rawSchema,
			}
			claudeTools = append(claudeTools, claudeTool)
			toolNameMap[originalName] = originalName
		}

		if len(claudeTools) > 0 {
			// Add cache_control to the last non-defer-loading tool
			for i := len(claudeTools) - 1; i >= 0; i-- {
				if t, ok := claudeTools[i].(map[string]any); ok {
					t["cache_control"] = map[string]any{"type": "ephemeral", "ttl": "1h"}
					break
				}
			}
			result["tools"] = claudeTools
		}
	}

	// Tool choice
	if tc, ok := body["tool_choice"]; ok {
		result["tool_choice"] = convertOpenAIToolChoice(tc)
	}

	// response_format: inject JSON instruction into system prompt
	if rf, ok := body["response_format"].(map[string]any); ok {
		rfType, _ := rf["type"].(string)
		switch rfType {
		case "json_schema":
			if schema, ok := rf["json_schema"].(map[string]any); ok {
				if s, ok := schema["schema"]; ok {
					b, _ := json.MarshalIndent(s, "", "  ")
					systemParts = append(systemParts,
						"You must respond with valid JSON that strictly follows this JSON schema:\n```json\n"+
							string(b)+"\n```\nRespond ONLY with the JSON object, no other text.")
				}
			}
		case "json_object":
			systemParts = append(systemParts,
				"You must respond with valid JSON. Respond ONLY with a JSON object, no other text.")
		}
	}

	// System messages
	if len(systemParts) > 0 {
		systemText := strings.Join(systemParts, "\n")
		systemBlock := map[string]any{
			"type":         "text",
			"text":         systemText,
			"cache_control": map[string]any{"type": "ephemeral", "ttl": "1h"},
		}
		if bodySystem, ok := body["system"].([]any); ok {
			result["system"] = append(bodySystem, systemBlock)
		} else if bodySystemStr, ok := body["system"].(string); ok && len(bodySystemStr) > 0 {
			result["system"] = []any{
				map[string]any{"type": "text", "text": bodySystemStr},
				systemBlock,
			}
		} else {
			result["system"] = []any{systemBlock}
		}
	} else if bodySystem, ok := body["system"]; ok {
		switch s := bodySystem.(type) {
		case []any:
			result["system"] = s
		case string:
			result["system"] = []any{map[string]any{"type": "text", "text": s}}
		}
	}

	// Empty-messages guard
	if messagesArr, ok := result["messages"].([]any); !ok || len(messagesArr) == 0 {
		result["messages"] = []any{
			map[string]any{"role": "user", "content": []any{map[string]any{"type": "text", "text": "."}}},
		}
	}

	return result
}

func getContentBlocksFromMessage(msg map[string]any) []any {
	var blocks []any
	role, _ := msg["role"].(string)

	if role == "tool" {
		toolCallID, _ := msg["tool_call_id"].(string)
		if toolCallID == "" {
			return blocks
		}
		content := msg["content"]
		blocks = append(blocks, map[string]any{
			"type":         "tool_result",
			"tool_use_id":  toolCallID,
			"content":      content,
		})
		return blocks
	}

	if role == "user" {
		content := msg["content"]
		switch c := content.(type) {
		case string:
			if c != "" {
				blocks = append(blocks, map[string]any{"type": "text", "text": c})
			}
		case []any:
			for _, part := range c {
				partMap, ok := part.(map[string]any)
				if !ok {
					continue
				}
				ptype, _ := partMap["type"].(string)
				switch ptype {
				case "text":
					if text, ok := partMap["text"].(string); ok && text != "" {
						blocks = append(blocks, map[string]any{"type": "text", "text": text})
					}
				case "tool_result":
					if tcuID, ok := partMap["tool_use_id"].(string); ok && tcuID != "" {
						resultContent := partMap["content"]
						toolResult := map[string]any{
							"type":        "tool_result",
							"tool_use_id": tcuID,
							"content":     resultContent,
						}
						if isErr, ok := partMap["is_error"]; ok {
							toolResult["is_error"] = isErr
						}
						blocks = append(blocks, toolResult)
					}
				case "image_url":
					if imgURL, ok := partMap["image_url"].(map[string]any); ok {
						if url, ok := imgURL["url"].(string); ok {
							if idx := strings.Index(url, "base64,"); idx > 0 {
								mediaType := url[len("data:"):idx]
								data := url[idx+len("base64,"):]
								blocks = append(blocks, map[string]any{
									"type": "image",
									"source": map[string]any{
										"type":       "base64",
										"media_type": mediaType,
										"data":       data,
									},
								})
							} else if strings.TrimSpace(url) != "" {
								blocks = append(blocks, map[string]any{
									"type": "image",
									"source": map[string]any{
										"type": "url",
										"url":  url,
									},
								})
							}
						}
					}
				case "image":
					if src, ok := partMap["source"]; ok {
						blocks = append(blocks, map[string]any{"type": "image", "source": src})
					}
				}
			}
		}
		return blocks
	}

	if role == "assistant" {
		// Content array
		contentArr, isArr := msg["content"].([]any)
		if isArr {
			for _, part := range contentArr {
				partMap, ok := part.(map[string]any)
				if !ok {
					continue
				}
				ptype, _ := partMap["type"].(string)
				switch ptype {
				case "text":
					if text, ok := partMap["text"].(string); ok && text != "" {
						blocks = append(blocks, map[string]any{"type": "text", "text": text})
					}
				case "thinking", "redacted_thinking":
					if ptype == "thinking" {
						if sig, ok := partMap["signature"].(string); ok && sig == "" {
							continue // Drop synthesized from non-Anthropic provider
						}
					}
					if ptype == "redacted_thinking" {
						if data, ok := partMap["data"].(string); ok && data == "" {
							continue
						}
					}
					block := map[string]any{
						"type": ptype,
					}
					if thinking, ok := partMap["thinking"]; ok {
						block["thinking"] = thinking
					}
					if sig, ok := partMap["signature"].(string); ok && sig != "" {
						block["signature"] = sig
					}
					if data, ok := partMap["data"]; ok {
						block["data"] = data
					}
					blocks = append(blocks, block)
				case "tool_use":
					if name, ok := partMap["name"].(string); ok && strings.TrimSpace(name) != "" {
						id, _ := partMap["id"].(string)
						input := partMap["input"]
						blocks = append(blocks, map[string]any{
							"type":  "tool_use",
							"id":    id,
							"name":  name,
							"input": input,
						})
					}
				}
			}
		} else if content, ok := msg["content"]; ok {
			text := ""
			switch c := content.(type) {
			case string:
				text = c
			}
			if text != "" {
				blocks = append(blocks, map[string]any{"type": "text", "text": text})
			}
		}

		// tool_calls (OpenAI format)
		if toolCalls, ok := msg["tool_calls"].([]any); ok {
			for _, tc := range toolCalls {
				tcMap, ok := tc.(map[string]any)
				if !ok {
					continue
				}
				if tcMap["type"] != "function" {
					continue
				}
				fn, ok := tcMap["function"].(map[string]any)
				if !ok {
					continue
				}
				fnName, _ := fn["name"].(string)
				if fnName == "" || strings.TrimSpace(fnName) == "" {
					continue
				}
				id, _ := tcMap["id"].(string)
				argsStr, _ := fn["arguments"].(string)
				var input any
				if argsStr != "" {
					if err := json.Unmarshal([]byte(argsStr), &input); err != nil {
						input = argsStr
					}
				} else {
					input = map[string]any{}
				}
				blocks = append(blocks, map[string]any{
					"type":  "tool_use",
					"id":    id,
					"name":  fnName,
					"input": input,
				})
			}
		}
	}

	return blocks
}

func convertOpenAIToolChoice(choice any) any {
	if choice == nil {
		return map[string]any{"type": "auto"}
	}
	switch c := choice.(type) {
	case string:
		switch c {
		case "auto", "none":
			return map[string]any{"type": "auto"}
		case "required":
			return map[string]any{"type": claudeToolChoiceRequired}
		default:
			return map[string]any{"type": "auto"}
		}
	case map[string]any:
		t, _ := c["type"].(string)
		switch t {
		case "function":
			if fn, ok := c["function"].(map[string]any); ok {
				if name, ok := fn["name"].(string); ok {
					return map[string]any{"type": "tool", "name": name}
				}
			}
		case "auto", "none":
			return map[string]any{"type": "auto"}
		case "required", "any":
			return map[string]any{"type": claudeToolChoiceRequired}
		case "tool":
			if _, ok := c["name"]; ok {
				return c
			}
		}
		return map[string]any{"type": "auto"}
	}
	return map[string]any{"type": "auto"}
}

func adjustMaxTokens(body map[string]any) int {
	if mt, ok := body["max_tokens"]; ok {
		if v, ok := toInt(mt); ok && v > 0 {
			return v
		}
	}
	if mct, ok := body["max_completion_tokens"]; ok {
		if v, ok := toInt(mct); ok && v > 0 {
			return v
		}
	}
	return 4096
}

func toInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case json.Number:
		i, err := n.Int64()
		return int(i), err == nil
	}
	return 0, false
}

// enforceToolResultAdjacency ensures each tool_result is in a message that
// immediately follows an assistant message. This is required by Claude's API.
func enforceToolResultAdjacency(messages []any) []any {
	if len(messages) == 0 {
		return messages
	}

	var result []any
	var pendingToolResults []any

	for _, msg := range messages {
		msgMap, ok := msg.(map[string]any)
		if !ok {
			result = append(result, msg)
			continue
		}

		role, _ := msgMap["role"].(string)

		// Check if this is a user message containing tool_result blocks
		if role == "user" {
			contentArr, isArr := msgMap["content"].([]any)
			if isArr {
				var toolResultBlocks, otherBlocks []any
				for _, block := range contentArr {
					bm, ok := block.(map[string]any)
					if ok && bm["type"] == "tool_result" {
						toolResultBlocks = append(toolResultBlocks, block)
					} else {
						otherBlocks = append(otherBlocks, block)
					}
				}
				if len(toolResultBlocks) > 0 {
					pendingToolResults = append(pendingToolResults, toolResultBlocks...)
				}
				if len(otherBlocks) > 0 {
					if len(pendingToolResults) > 0 {
						result = append(result, map[string]any{
							"role":    "user",
							"content": pendingToolResults,
						})
						pendingToolResults = nil
					}
				if len(otherBlocks) == 1 {
					result = append(result, map[string]any{
						"role":    "user",
						"content": otherBlocks,
					})
					} else {
						result = append(result, map[string]any{
							"role":    "user",
							"content": otherBlocks,
						})
					}
				}
				continue
			}
		}

		// Flush pending tool results before non-user messages
		if role != "user" && len(pendingToolResults) > 0 {
			result = append(result, map[string]any{
				"role":    "user",
				"content": pendingToolResults,
			})
			pendingToolResults = nil
		}

		result = append(result, msg)
	}

	// Flush remaining tool results
	if len(pendingToolResults) > 0 {
		result = append(result, map[string]any{
			"role":    "user",
			"content": pendingToolResults,
		})
	}

	return result
}
