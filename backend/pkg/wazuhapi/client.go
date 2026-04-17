package wazuhapi

type Client struct {
	BaseURL string
}

func (client Client) Health() string {
	return "stubbed"
}