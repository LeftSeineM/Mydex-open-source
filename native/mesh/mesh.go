// Package mesh embeds an app-only tailnet. No VPN interface or system routes.
package mesh

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"

	"tailscale.com/envknob"
	"tailscale.com/tsnet"
)

var mu sync.Mutex
var server *tsnet.Server
var proxy *http.Server
var endpoint, password string
var allowed = map[string]bool{}

// Start is idempotent; stateDir must be Android's private no-backup directory.
func Start(stateDir string) error {
	mu.Lock()
	defer mu.Unlock()
	if server != nil {
		return nil
	}
	envknob.SetNoLogsNoSupport()
	s := &tsnet.Server{Dir: stateDir, Hostname: "mydex-android", Logf: func(string, ...any) {}, UserLogf: func(string, ...any) {}}
	if err := s.Start(); err != nil {
		return err
	}
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		s.Close()
		return err
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		ln.Close()
		s.Close()
		return err
	}
	password = base64.RawURLEncoding.EncodeToString(key)
	endpoint = ln.Addr().String()
	server = s
	proxy = &http.Server{Handler: http.HandlerFunc(tunnel), ReadHeaderTimeout: 10 * time.Second, MaxHeaderBytes: 8192}
	go proxy.Serve(ln)
	return nil
}

// Tailnet literals only: never turn this into a general-purpose LAN proxy.
func validTarget(host string, port int) bool {
	ip, err := netip.ParseAddr(host)
	return err == nil && port > 0 && port <= 65535 &&
		(netip.MustParsePrefix("100.64.0.0/10").Contains(ip) || netip.MustParsePrefix("fd7a:115c:a1e0::/48").Contains(ip))
}

func Route(host string, port int) (string, error) {
	if !validTarget(host, port) {
		return "", errors.New("use a Tailscale IP and valid port")
	}
	mu.Lock()
	defer mu.Unlock()
	if server == nil {
		return "", errors.New("mesh not started")
	}
	allowed[net.JoinHostPort(host, strconv.Itoa(port))] = true
	b, err := json.Marshal(map[string]string{"endpoint": endpoint, "password": password})
	return string(b), err
}

func Status() (string, error) {
	mu.Lock()
	s := server
	mu.Unlock()
	if s == nil {
		return `{"state":"Stopped"}`, nil
	}
	c, err := s.LocalClient()
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	st, err := c.StatusWithoutPeers(ctx)
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(map[string]any{"state": st.BackendState, "authUrl": st.AuthURL})
	return string(b), err
}

func Login() error {
	mu.Lock()
	s := server
	mu.Unlock()
	if s == nil {
		return errors.New("mesh not started")
	}
	c, err := s.LocalClient()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return c.StartLoginInteractive(ctx)
}

func tunnel(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	s, key, ok := server, password, allowed[r.Host]
	mu.Unlock()
	want := "Basic " + base64.StdEncoding.EncodeToString([]byte("mydex:"+key))
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("Proxy-Authorization")), []byte(want)) != 1 {
		w.Header().Set("Proxy-Authenticate", `Basic realm="Mydex mesh"`)
		http.Error(w, "authentication required", http.StatusProxyAuthRequired)
		return
	}
	if r.Method != http.MethodConnect || !ok || s == nil || strings.ContainsAny(r.Host, "\r\n") {
		http.Error(w, "destination denied", http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	upstream, err := s.Dial(ctx, "tcp", r.Host)
	if err != nil {
		http.Error(w, "peer unavailable", http.StatusBadGateway)
		return
	}
	defer upstream.Close()
	client, rw, err := w.(http.Hijacker).Hijack()
	if err != nil {
		return
	}
	defer client.Close()
	if _, err = rw.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		return
	}
	if err = rw.Flush(); err != nil {
		return
	}
	done := make(chan struct{})
	go func() { io.Copy(upstream, rw); upstream.Close(); close(done) }()
	io.Copy(client, upstream)
	client.Close()
	<-done
}
