package saltapi

type Client struct {
	BaseURL string
}

func (client Client) TriggerPatch(scope string) map[string]string {
	return map[string]string{"status": "queued", "scope": scope}
}