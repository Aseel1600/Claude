package streaming

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// SSEWriter writes Server-Sent Events to an http.ResponseWriter.
type SSEWriter struct {
	w       io.Writer
	flusher http.Flusher
}

// NewSSEWriter creates a new SSEWriter that writes to the given response writer.
// Sets the required SSE headers.
func NewSSEWriter(w http.ResponseWriter) *SSEWriter {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, _ := w.(http.Flusher)
	return &SSEWriter{
		w:       w,
		flusher: flusher,
	}
}

// WriteEvent writes a named SSE event with JSON data.
func (s *SSEWriter) WriteEvent(event, data string) error {
	var sb strings.Builder
	if event != "" && event != "message" {
		sb.WriteString("event: ")
		sb.WriteString(event)
		sb.WriteString("\n")
	}
	sb.WriteString("data: ")
	sb.WriteString(data)
	sb.WriteString("\n\n")
	_, err := s.w.Write([]byte(sb.String()))
	if err != nil {
		return err
	}
	s.flush()
	return nil
}

// WriteChunk writes a raw SSE data line (data: <json>\n\n).
func (s *SSEWriter) WriteChunk(data []byte) error {
	_, err := fmt.Fprintf(s.w, "data: %s\n\n", data)
	if err != nil {
		return err
	}
	s.flush()
	return nil
}

// WriteDone writes the SSE [DONE] sentinel.
func (s *SSEWriter) WriteDone() error {
	_, err := fmt.Fprint(s.w, "data: [DONE]\n\n")
	if err != nil {
		return err
	}
	s.flush()
	return nil
}

// WriteKeepalive writes a comment line to keep the connection alive.
func (s *SSEWriter) WriteKeepalive() error {
	_, err := fmt.Fprint(s.w, ": keepalive\n\n")
	if err != nil {
		return err
	}
	s.flush()
	return nil
}

func (s *SSEWriter) flush() {
	if s.flusher != nil {
		s.flusher.Flush()
	}
}

// ProxySSEStream reads SSE events from an upstream response and forwards
// them to the client. Handles context cancellation and keepalive.
func ProxySSEStream(ctx context.Context, upstreamResp *http.Response, w http.ResponseWriter) error {
	_ = NewSSEWriter(w) // ensure SSE headers are set

	scanner := bufio.NewScanner(upstreamResp.Body)
	defer upstreamResp.Body.Close()

	// Increase scanner buffer for large SSE events
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var currentEvent strings.Builder
	var currentData strings.Builder
	hasData := false

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if !scanner.Scan() {
			break
		}
		line := scanner.Text()

		// Empty line = dispatch event
		if line == "" {
			if hasData {
				data := currentData.String()
				event := currentEvent.String()

				// Write as raw SSE (preserving original format)
				var sb strings.Builder
				if event != "" {
					sb.WriteString("event: ")
					sb.WriteString(event)
					sb.WriteString("\n")
				}
				sb.WriteString("data: ")
				sb.WriteString(data)
				sb.WriteString("\n\n")

				if _, err := io.WriteString(w, sb.String()); err != nil {
					return err
				}
				if flusher, ok := w.(http.Flusher); ok {
					flusher.Flush()
				}

				currentEvent.Reset()
				currentData.Reset()
				hasData = false
			}
			continue
		}

		// Parse SSE field
		switch {
		case strings.HasPrefix(line, "event:"):
			currentEvent.WriteString(strings.TrimPrefix(line, "event:"))
			currentEvent.WriteString("\n")
			hasData = true
		case strings.HasPrefix(line, "data:"):
			if currentData.Len() > 0 {
				currentData.WriteString("\n")
			}
			currentData.WriteString(strings.TrimPrefix(line, "data:"))
			hasData = true
		case strings.HasPrefix(line, "id:"):
			// Ignore id field for now
		case strings.HasPrefix(line, "retry:"):
			// Ignore retry field for now
		case strings.HasPrefix(line, ":"):
			// Comment line (keepalive), ignore
		default:
			// Continuation line for the last field
			if currentData.Len() > 0 {
				currentData.WriteString("\n")
				currentData.WriteString(line)
				hasData = true
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("error reading upstream SSE stream: %w", err)
	}

	return nil
}
