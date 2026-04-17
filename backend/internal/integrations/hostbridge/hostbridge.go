package hostbridge

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
)

func DialContext(ctx context.Context, network string, address string) (net.Conn, error) {
	targetAddress := address
	host, port, err := net.SplitHostPort(address)
	if err == nil {
		if gateway := gatewayHostFor(host); gateway != "" {
			targetAddress = net.JoinHostPort(gateway, port)
		}
	}

	var dialer net.Dialer
	return dialer.DialContext(ctx, network, targetAddress)
}

func gatewayHostFor(host string) string {
	if !runningInContainer() {
		return ""
	}

	switch normalizeHost(host) {
	case "localhost", "127.0.0.1", "::1":
		gateway, err := defaultGatewayIPv4()
		if err == nil {
			return gateway
		}
	}

	return ""
}

func runningInContainer() bool {
	_, err := os.Stat("/.dockerenv")
	return err == nil
}

func normalizeHost(host string) string {
	trimmed := strings.TrimSpace(strings.Trim(host, "[]"))
	return strings.ToLower(trimmed)
}

func defaultGatewayIPv4() (string, error) {
	file, err := os.Open("/proc/net/route")
	if err != nil {
		return "", err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 3 || fields[1] != "00000000" {
			continue
		}
		return decodeRouteHexIPv4(fields[2])
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return "", fmt.Errorf("default gateway not found")
}

func decodeRouteHexIPv4(value string) (string, error) {
	if len(value) != 8 {
		return "", fmt.Errorf("unexpected gateway value %q", value)
	}

	parts := make([]string, 0, 4)
	for index := 6; index >= 0; index -= 2 {
		segment, err := strconv.ParseUint(value[index:index+2], 16, 8)
		if err != nil {
			return "", err
		}
		parts = append(parts, strconv.FormatUint(segment, 10))
	}
	return strings.Join(parts, "."), nil
}