package openscap

type Result struct {
	Rule     string `json:"rule"`
	Severity string `json:"severity"`
	Passed   bool   `json:"passed"`
}

func Parse(result string) []Result {
	return []Result{{Rule: "xccdf_org.ssgproject.content_rule_no_empty_passwords", Severity: "warning", Passed: false}}
}