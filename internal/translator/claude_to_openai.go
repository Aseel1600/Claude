package translator

import (
	"encoding/json"
	"strings"
)

func init() {
	registerRequestTranslator(FormatClaude, FormatOpenAI, claudeToOpenAIRequest)
}

// claudeToOpenAIRequest translates a Claude Messages API request body into
// OpenAI chat completions format.
func claudeToOpenAIRequest(model string, body map[string]any) map[string]any {
	result := map[string]any{
		"model":    model,
		"messages": []any{},
		"stream":   body["stream"],
	}

	// Max tokens
	if body["max_tokens"] != nil {
		result["max_tokens"] = adjustMaxTokens(body)
	}

	// Temperature
	if temp, ok := body["temperature"]; ok {
		result["temperature"] = temp
	}
	if topP, ok := body["top_p"]; ok {
		result["top_p"] = topP
	}
	if stop, ok := body["stop_sequences"]; ok {
		result["stop"] = stop
	}

	// System message
	if bodySystem, ok := body["system"]; ok {
		var systemContent string
		switch s := bodySystem.(type) {
		case string:
			systemContent = stripAnthropicBillingHeader(s)
		case []any:
			var parts []string
			for _, block := range s {
				switch b := block.(type) {
				case string:
					parts = append(parts, stripAnthropicBillingHeader(b))
				case map[string]any:
					if text, ok := b["text"].(string); ok {
						parts = append(parts, stripAnthropicBillingHeader(text))
					}
				}
			}
			systemContent = strings.Join(parts, "\n")
		}
		if systemContent != "" {
			msgs := result["messages"].([]any)
			result["messages"] = append(msgs, map[string]any{
				"role":    "system",
				"content": systemContent,
			})
		}
	}

	// Convert messages
	if msgs, ok := body["messages"].([]any); ok {
		for _, msg := range msgs {
			msgMap, ok := msg.(map[string]any)
			if !ok {
				continue
			}
			converted := convertClaudeMessage(msgMap)
			if converted == nil {
				continue
			}
			if arr, ok := converted.([]any); ok {
				result["messages"] = append(result["messages"].([]any), arr...)
			} else {
				result["messages"] = append(result["messages"].([]any), converted)
			}
		}
	}

	// Regroup tool messages
	result["messages"] = regroupToolMessages(result["messages"].([]any))

	// Fix missing tool responses
	fixMissingToolResponses(result["messages"].([]any))

	// Tools
	if bodyTools, ok := body["tools"].([]any); ok {
		var openaiTools []any
		for _, tool := range bodyTools {
			toolMap, ok := tool.(map[string]any)
			if !ok {
				continue
			}
			name, _ := toolMap["name"].(string)
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			desc, _ := toolMap["description"].(string)
			if desc == "" {
				desc = ""
			}
			schema := normalizeToolSchema(toolMap["input_schema"])

			openaiTools = append(openaiTools, map[string]any{
				"type": "function",
				"function": map[string]any{
					"name":        name,
					"description": desc,
					"parameters":  schema,
				},
			})
		}
		if len(openaiTools) > 0 {
			result["tools"] = openaiTools
		}
	}

	// Tool choice
	if tc, ok := body["tool_choice"]; ok {
		result["tool_choice"] = convertClaudeToolChoice(tc)
	}

	// Reasoning effort
	if oc, ok := body["output_config"].(map[string]any); ok {
		if effort, ok := oc["effort"].(string); ok {
			norm := normalizeOpenAIReasoningEffort(effort)
			if norm != "" {
				result["reasoning_effort"] = norm
			}
		}
	} else if thinking, ok := body["thinking"].(map[string]any); ok {
		if thinking["type"] == "enabled" {
			if bt, ok := thinking["budget_tokens"]; ok {
				budget := toIntOr0(bt)
				if budget > 0 {
					switch {
					case budget <= 1024:
						result["reasoning_effort"] = "low"
					case budget <= 10240:
						result["reasoning_effort"] = "medium"
					case budget < 131072:
						result["reasoning_effort"] = "high"
					default:
						result["reasoning_effort"] = "xhigh"
					}
				}
			}
		}
	}

	return result
}

func convertClaudeMessage(msg map[string]any) any {
	role, _ := msg["role"].(string)
	mappedRole := "assistant"
	if role == "user" || role == "tool" {
		mappedRole = "user"
	} else if role == "system" {
		mappedRole = "system"
	}

	// Simple string content
	if content, ok := msg["content"].(string); ok {
		return map[string]any{"role": mappedRole, "content": content}
	}

	// Array content
	contentArr, isArr := msg["content"].([]any)
	if !isArr {
		return nil
	}

	var parts []any
	var toolCalls []any
	var toolResults []any
	var reasoningContent *string

	for _, block := range contentArr {
		bm, ok := block.(map[string]any)
		if !ok {
			continue
		}
		btype, _ := bm["type"].(string)

		switch btype {
		case "text":
			text, _ := bm["text"].(string)
			if text != "" {
				parts = append(parts, map[string]any{"type": "text", "text": text})
			}

		case "image":
			if src, ok := bm["source"].(map[string]any); ok {
				srcType, _ := src["type"].(string)
				if srcType == "base64" {
					mt, _ := src["media_type"].(string)
					data, _ := src["data"].(string)
					parts = append(parts, map[string]any{
						"type": "image_url",
						"image_url": map[string]any{
							"url": "data:" + mt + ";base64," + data,
						},
					})
				} else if srcType == "url" {
					if url, ok := src["url"].(string); ok {
						parts = append(parts, map[string]any{
							"type": "image_url",
							"image_url": map[string]any{"url": url},
						})
					}
				}
			}

		case "thinking":
			text, _ := bm["thinking"].(string)
			if text == "" {
				text, _ = bm["text"].(string)
			}
			reasoningContent = &text

		case "redacted_thinking":
			if reasoningContent == nil {
				empty := ""
				reasoningContent = &empty
			}

		case "tool_use":
			input := bm["input"]
			var argsStr string
			switch i := input.(type) {
			case string:
				argsStr = i
			default:
				b, _ := json.Marshal(i)
				argsStr = string(b)
			}
			toolCalls = append(toolCalls, map[string]any{
				"id":   bm["id"],
				"type": "function",
				"function": map[string]any{
					"name":      bm["name"],
					"arguments": argsStr,
				},
			})

		case "tool_result":
			var resultContent string
			switch c := bm["content"].(type) {
			case string:
				resultContent = c
			case []any:
				var textParts []string
				for _, item := range c {
					im, ok := item.(map[string]any)
					if !ok {
						continue
					}
					if im["type"] == "text" {
						if t, ok := im["text"].(string); ok {
							textParts = append(textParts, t)
						}
					}
				}
				if len(textParts) > 0 {
					resultContent = strings.Join(textParts, "\n")
				} else {
					b, _ := json.Marshal(c)
					resultContent = string(b)
				}
			default:
				if c != nil {
					b, _ := json.Marshal(c)
					resultContent = string(b)
				}
			}
			toolUseID, _ := bm["tool_use_id"].(string)
			toolResults = append(toolResults, map[string]any{
				"role":         "tool",
				"tool_call_id": toolUseID,
				"content":      resultContent,
			})
		}
	}

	// If tool results, return them
	if len(toolResults) > 0 {
		if len(parts) > 0 {
			textContent := ""
			if len(parts) == 1 {
				if p, ok := parts[0].(map[string]any); ok {
					if t, ok := p["text"].(string); ok {
						textContent = t
					}
				}
			}
			if textContent == "" {
				textContent = ""
			}
			return append(toolResults, map[string]any{"role": "user", "content": textContent})
		}
		return toolResults
	}

	// If tool calls, return assistant with tool_calls
	if len(toolCalls) > 0 {
		result := map[string]any{"role": "assistant"}
		if len(parts) > 0 {
			if len(parts) == 1 {
				if p, ok := parts[0].(map[string]any); ok {
					if t, ok := p["text"].(string); ok {
						result["content"] = t
					}
				}
			} else {
				result["content"] = parts
			}
		}
		result["tool_calls"] = toolCalls
		if reasoningContent != nil {
			result["reasoning_content"] = *reasoningContent
		}
		return result
	}

	// Regular content
	if len(parts) > 0 {
		r := map[string]any{"role": mappedRole}
		if len(parts) == 1 {
			if p, ok := parts[0].(map[string]any); ok {
				if t, ok := p["text"].(string); ok {
					r["content"] = t
				} else {
					r["content"] = parts
				}
			} else {
				r["content"] = parts
			}
		} else {
			r["content"] = parts
		}
		if reasoningContent != nil && mappedRole == "assistant" {
			r["reasoning_content"] = *reasoningContent
		}
		return r
	}

	if len(contentArr) == 0 {
		r := map[string]any{"role": mappedRole, "content": ""}
		if reasoningContent != nil && mappedRole == "assistant" {
			r["reasoning_content"] = *reasoningContent
		}
		return r
	}

	if reasoningContent != nil && mappedRole == "assistant" {
		return map[string]any{"role": mappedRole, "content": "", "reasoning_content": *reasoningContent}
	}

	return nil
}

func convertClaudeToolChoice(choice any) any {
	if choice == nil {
		return "auto"
	}
	switch c := choice.(type) {
	case string:
		return c
	case map[string]any:
		t, _ := c["type"].(string)
		switch t {
		case "auto":
			return "auto"
		case "any":
			return "required"
		case "tool":
			return map[string]any{
				"type":     "function",
				"function": map[string]any{"name": c["name"]},
			}
		default:
			return "auto"
		}
	}
	return "auto"
}

func normalizeToolSchema(schema any) map[string]any {
	fallback := map[string]any{"type": "object", "properties": map[string]any{}}
	if schema == nil {
		return fallback
	}
	s, ok := schema.(map[string]any)
	if !ok {
		return fallback
	}
	if s["type"] == "object" && s["properties"] == nil {
		sCopy := make(map[string]any, len(s)+1)
		for k, v := range s {
			sCopy[k] = v
		}
		sCopy["properties"] = map[string]any{}
		return sCopy
	}
	return s
}

func normalizeOpenAIReasoningEffort(effort string) string {
	if effort == "" {
		return ""
	}
	normalized := strings.ToLower(effort)
	if normalized == "max" {
		return "xhigh"
	}
	return normalized
}

func toIntOr0(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	}
	return 0
}

func stripAnthropicBillingHeader(text string) string {
	lines := strings.Split(text, "\n")
	var result []string
	for _, line := range lines {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(line)), "x-anthropic-billing-header:") {
			continue
		}
		result = append(result, line)
	}
	return strings.Join(result, "\n")
}

// regroupToolMessages re-groups tool result messages so every tool role message
// sits immediately after the assistant turn that issued the tool call.
func regroupToolMessages(messages []any) []any {
	// Build tool_call_id → assistant index map
	callIDToAssistant := map[string]int{}
	for i, msg := range messages {
		msgMap, ok := msg.(map[string]any)
		if !ok {
			continue
		}
		if msgMap["role"] != "assistant" {
			continue
		}
		tcs, ok := msgMap["tool_calls"].([]any)
		if !ok {
			continue
		}
		for _, tc := range tcs {
			tcMap, ok := tc.(map[string]any)
			if !ok {
				continue
			}
			id, _ := tcMap["id"].(string)
			if id != "" {
				if _, exists := callIDToAssistant[id]; !exists {
					callIDToAssistant[id] = i
				}
			}
		}
	}

	// Collect tool messages per assistant index
	type toolEntry struct {
		id   string
		msg  any
	}
	toolsByAssistant := map[int][]toolEntry{}
	for _, msg := range messages {
		msgMap, ok := msg.(map[string]any)
		if !ok {
			continue
		}
		if msgMap["role"] != "tool" {
			continue
		}
		callID, _ := msgMap["tool_call_id"].(string)
		assistantIdx, ok := callIDToAssistant[callID]
		if !ok {
			continue // orphan → drop
		}
		toolsByAssistant[assistantIdx] = append(toolsByAssistant[assistantIdx], toolEntry{id: callID, msg: msg})
	}

	// Rebuild
	var out []any
	for i, msg := range messages {
		msgMap, ok := msg.(map[string]any)
		if !ok {
			out = append(out, msg)
			continue
		}
		if msgMap["role"] == "tool" {
			continue // moved into its assistant's group
		}
		out = append(out, msg)

		if msgMap["role"] == "assistant" {
			tcs, ok := msgMap["tool_calls"].([]any)
			if !ok {
				continue
			}
			entries := toolsByAssistant[i]
			if len(entries) == 0 {
				continue
			}
			entryByCallID := map[string]any{}
			for _, e := range entries {
				entryByCallID[e.id] = e.msg
			}
			for _, tc := range tcs {
				tcMap, ok := tc.(map[string]any)
				if !ok {
					continue
				}
				id, _ := tcMap["id"].(string)
				if toolMsg, ok := entryByCallID[id]; ok {
					out = append(out, toolMsg)
				}
			}
		}
	}
	return out
}

// fixMissingToolResponses adds empty placeholder responses for tool_calls without responses.
func fixMissingToolResponses(messages []any) {
	for i := 0; i < len(messages); i++ {
		msgMap, ok := messages[i].(map[string]any)
		if !ok {
			continue
		}
		if msgMap["role"] != "assistant" {
			continue
		}
		tcs, ok := msgMap["tool_calls"].([]any)
		if !ok || len(tcs) == 0 {
			continue
		}

		var toolCallIDs []string
		for _, tc := range tcs {
			tcMap, ok := tc.(map[string]any)
			if !ok {
				continue
			}
			if id, ok := tcMap["id"].(string); ok {
				toolCallIDs = append(toolCallIDs, id)
			}
		}

		// Collect responded IDs immediately following
		respondedIDs := map[string]bool{}
		insertPos := i + 1
		for j := i + 1; j < len(messages); j++ {
			nextMap, ok := messages[j].(map[string]any)
			if !ok {
				break
			}
			if nextMap["role"] != "tool" {
				break
			}
			if tcid, ok := nextMap["tool_call_id"].(string); ok {
				respondedIDs[tcid] = true
				insertPos = j + 1
			}
		}

		// Find missing
		var missing []any
		for _, id := range toolCallIDs {
			if !respondedIDs[id] {
				missing = append(missing, map[string]any{
					"role":         "tool",
					"tool_call_id": id,
					"content":      "[No response received]",
				})
			}
		}

		if len(missing) > 0 {
			// Insert at insertPos
			newMessages := make([]any, 0, len(messages)+len(missing))
			newMessages = append(newMessages, messages[:insertPos]...)
			newMessages = append(newMessages, missing...)
			newMessages = append(newMessages, messages[insertPos:]...)
			messages = newMessages
			i = insertPos + len(missing) - 1
		}
	}
}
