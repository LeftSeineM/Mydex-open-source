package mesh

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTargetScope(t *testing.T) {
	for _, host := range []string{"127.0.0.1", "192.168.1.1", "8.8.8.8", "100.63.255.255", "100.128.0.1", "example.com", "::1"} {
		if validTarget(host, 443) {
			t.Fatalf("unexpected target: %s", host)
		}
	}
	for _, host := range []string{"100.64.0.1", "100.127.255.254", "fd7a:115c:a1e0::1"} {
		if !validTarget(host, 18443) {
			t.Fatalf("rejected tailnet IP: %s", host)
		}
	}
	if validTarget("100.64.0.1", 0) || validTarget("100.64.0.1", 65536) {
		t.Fatal("invalid port allowed")
	}
}

func TestProxyRejectsUnauthenticatedAndUnregistered(t *testing.T) {
	mu.Lock()
	password = "test-secret"
	mu.Unlock()
	for _, authorized := range []bool{false, true} {
		r := httptest.NewRequest(http.MethodConnect, "http://100.64.0.1:18443", nil)
		if authorized {
			r.Header.Set("Proxy-Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("mydex:test-secret")))
		}
		w := httptest.NewRecorder()
		tunnel(w, r)
		want := http.StatusProxyAuthRequired
		if authorized {
			want = http.StatusForbidden
		}
		if w.Code != want {
			t.Fatalf("got %d, expected %d", w.Code, want)
		}
	}
}
