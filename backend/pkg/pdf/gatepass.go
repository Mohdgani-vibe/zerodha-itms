package pdf

import (
	"bytes"
	"fmt"
	"math"
	"strings"
)

var code39Patterns = map[rune]string{
	'0': "nnnwwnwnn",
	'1': "wnnwnnnnw",
	'2': "nnwwnnnnw",
	'3': "wnwwnnnnn",
	'4': "nnnwwnnnw",
	'5': "wnnwwnnnn",
	'6': "nnwwwnnnn",
	'7': "nnnwnnwnw",
	'8': "wnnwnnwnn",
	'9': "nnwwnnwnn",
	'A': "wnnnnwnnw",
	'B': "nnwnnwnnw",
	'C': "wnwnnwnnn",
	'D': "nnnnwwnnw",
	'E': "wnnnwwnnn",
	'F': "nnwnwwnnn",
	'G': "nnnnnwwnw",
	'H': "wnnnnwwnn",
	'I': "nnwnnwwnn",
	'J': "nnnnwwwnn",
	'K': "wnnnnnnww",
	'L': "nnwnnnnww",
	'M': "wnwnnnnwn",
	'N': "nnnnwnnww",
	'O': "wnnnwnnwn",
	'P': "nnwnwnnwn",
	'Q': "nnnnnnwww",
	'R': "wnnnnnwwn",
	'S': "nnwnnnwwn",
	'T': "nnnnwnwwn",
	'U': "wwnnnnnnw",
	'V': "nwwnnnnnw",
	'W': "wwwnnnnnn",
	'X': "nwnnwnnnw",
	'Y': "wwnnwnnnn",
	'Z': "nwwnwnnnn",
	'-': "nwnnnnwnw",
	'.': "wwnnnnwnn",
	' ': "nwwnnnwnn",
	'$': "nwnwnwnnn",
	'/': "nwnwnnnwn",
	'+': "nwnnnwnwn",
	'%': "nnnwnwnwn",
	'*': "nwnnwnwnn",
}

func RenderGatepass(id string, requester string, employeeName string, employeeCode string, departmentName string, contactNumber string, assetRef string, assetDescription string, originBranch string, recipientBranch string, issueDate string, purpose string, status string, issuerSignedName string, issuerSignedAt string, approverName string, receiverSignedAt string, securitySignedName string, securitySignedAt string) []byte {
	var content bytes.Buffer
	content.WriteString("0.75 w\n")

	writeBox(&content, 36, 698, 540, 102)
	writeBox(&content, 36, 610, 170, 64)
	writeBox(&content, 221, 610, 170, 64)
	writeBox(&content, 406, 610, 170, 64)
	writeBox(&content, 36, 450, 540, 136)
	writeBox(&content, 36, 318, 540, 112)
	writeDashedBox(&content, 36, 138, 168, 120)
	writeDashedBox(&content, 222, 138, 168, 120)
	writeDashedBox(&content, 408, 138, 168, 120)

	writeText(&content, 48, 764, 20, "ZERODHA")
	writeText(&content, 48, 738, 20, "GATEPASS")
	writeText(&content, 360, 766, 9, "DATE OF GATEPASS ISSUED")
	writeText(&content, 492, 766, 11, safePDFValue(issueDate))
	drawBarcode(&content, 340, 720, safePDFValue(id))
	writeText(&content, 455, 704, 10, safePDFValue(id))

	writeLabelAndValue(&content, 48, 654, "FROM BRANCH", safePDFValue(originBranch))
	writeLabelAndValue(&content, 233, 654, "RECEIVER BRANCH", safePDFValue(recipientBranch))
	writeLabelAndValue(&content, 418, 654, "ISSUE DATE", safePDFValue(issueDate))

	writeText(&content, 48, 560, 12, "Recipient Details")
	writeText(&content, 48, 526, 9, "EMPLOYEE NAME")
	writeText(&content, 48, 506, 11, safePDFValue(employeeName))
	writeText(&content, 300, 526, 9, "EMPLOYEE ID")
	writeText(&content, 300, 506, 11, safePDFValue(employeeCode))
	writeText(&content, 48, 474, 9, "DEPARTMENT")
	writeText(&content, 48, 454, 11, safePDFValue(departmentName))
	writeText(&content, 300, 474, 9, "CONTACT NUMBER")
	writeText(&content, 300, 454, 11, safePDFValue(contactNumber))

	writeText(&content, 48, 410, 12, "Asset Details")
	writeText(&content, 48, 376, 9, "ASSET TAG / ID")
	writeText(&content, 48, 356, 11, safePDFValue(assetRef))
	writeText(&content, 300, 376, 9, "PURPOSE")
	writeText(&content, 300, 356, 11, safePDFValue(purpose))
	writeText(&content, 48, 324, 9, "ASSET DESCRIPTION")
	for index, line := range wrapPDFText(safePDFValue(assetDescription), 78) {
		writeText(&content, 48, 304-(index*14), 11, line)
	}

	writeLabelAndValue(&content, 48, 226, "ISSUED BY", safePDFValue(firstNonEmpty(issuerSignedName, requester, employeeName)))
	writeSignatureLine(&content, 52, 164, 136)
	writeText(&content, 52, 146, 10, "Issued Employee Signature")
	writeLabelAndValue(&content, 234, 226, "APPROVER NAME", safePDFValue(firstNonEmpty(approverName, "Approver Pending")))
	writeSignatureLine(&content, 238, 164, 136)
	writeText(&content, 238, 146, 10, "Approver Name and Signature")
	writeLabelAndValue(&content, 420, 226, "SECURITY CHECK", safePDFValue(firstNonEmpty(securitySignedName, "Security Guard")))
	writeSignatureLine(&content, 424, 164, 136)
	writeText(&content, 424, 146, 10, "Security Sign")

	stream := content.String()
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(stream), stream),
	}

	var pdf bytes.Buffer
	pdf.WriteString("%PDF-1.4\n")
	offsets := make([]int, 0, len(objects)+1)
	offsets = append(offsets, 0)
	for index, object := range objects {
		offsets = append(offsets, pdf.Len())
		pdf.WriteString(fmt.Sprintf("%d 0 obj\n%s\nendobj\n", index+1, object))
	}
	xrefOffset := pdf.Len()
	pdf.WriteString(fmt.Sprintf("xref\n0 %d\n", len(offsets)))
	pdf.WriteString("0000000000 65535 f \n")
	for _, offset := range offsets[1:] {
		pdf.WriteString(fmt.Sprintf("%010d 00000 n \n", offset))
	}
	pdf.WriteString(fmt.Sprintf("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF", len(offsets), xrefOffset))

	return pdf.Bytes()
}

func writeBox(buffer *bytes.Buffer, x int, y int, width int, height int) {
	buffer.WriteString(fmt.Sprintf("%d %d %d %d re S\n", x, y, width, height))
}

func writeDashedBox(buffer *bytes.Buffer, x int, y int, width int, height int) {
	buffer.WriteString("[3 3] 0 d\n")
	buffer.WriteString(fmt.Sprintf("%d %d %d %d re S\n", x, y, width, height))
	buffer.WriteString("[] 0 d\n")
}

func writeText(buffer *bytes.Buffer, x int, y int, size int, text string) {
	buffer.WriteString("BT\n")
	buffer.WriteString(fmt.Sprintf("/F1 %d Tf\n", size))
	buffer.WriteString(fmt.Sprintf("1 0 0 1 %d %d Tm\n", x, y))
	buffer.WriteString("(" + escapePDFText(text) + ") Tj\n")
	buffer.WriteString("ET\n")
}

func writeLabelAndValue(buffer *bytes.Buffer, x int, y int, label string, value string) {
	writeText(buffer, x, y, 9, label)
	lines := wrapPDFText(value, 28)
	for index, line := range lines {
		writeText(buffer, x, y-20-(index*14), 12, line)
	}
}

func writeSignatureLine(buffer *bytes.Buffer, x int, y int, width int) {
	buffer.WriteString(fmt.Sprintf("%d %d m %d %d l S\n", x, y, x+width, y))
}

func drawBarcode(buffer *bytes.Buffer, x int, y int, value string) {
	encoded := "*" + normalizeBarcodeValue(value) + "*"
	position := float64(x + 8)
	narrow := 1.4
	wide := 3.2
	gap := 1.4
	for charIndex, char := range encoded {
		pattern, ok := code39Patterns[char]
		if !ok {
			pattern = code39Patterns['-']
		}
		for index, symbol := range pattern {
			width := narrow
			if symbol == 'w' {
				width = wide
			}
			if index%2 == 0 {
				buffer.WriteString(fmt.Sprintf("%.2f %d %.2f %d re f\n", position, y, width, 32))
			}
			position += width
		}
		if charIndex < len(encoded)-1 {
			position += gap
		}
	}
}


func normalizeBarcodeValue(value string) string {
	cleaned := strings.ToUpper(strings.TrimSpace(value))
	if cleaned == "" {
		return "PENDING"
	}
	runes := make([]rune, 0, len(cleaned))
	for _, char := range cleaned {
		if _, ok := code39Patterns[char]; ok && char != '*' {
			runes = append(runes, char)
			continue
		}
		runes = append(runes, '-')
	}
	return string(runes)
}

func wrapPDFText(text string, maxChars int) []string {
	cleaned := safePDFValue(text)
	if len(cleaned) <= maxChars {
		return []string{cleaned}
	}
	words := strings.Fields(cleaned)
	if len(words) == 0 {
		return []string{"-"}
	}
	lines := make([]string, 0)
	current := words[0]
	for _, word := range words[1:] {
		candidate := current + " " + word
		if approximateWidth(candidate) <= float64(maxChars) {
			current = candidate
			continue
		}
		lines = append(lines, current)
		current = word
	}
	lines = append(lines, current)
	if len(lines) > 3 {
		return append(lines[:2], truncatePDFLine(lines[2], maxChars-3)+"...")
	}
	return lines
}

func approximateWidth(value string) float64 {
	return math.Ceil(float64(len(value)) * 0.95)
}

func truncatePDFLine(value string, maxChars int) string {
	if len(value) <= maxChars {
		return value
	}
	if maxChars <= 0 {
		return ""
	}
	return value[:maxChars]
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func safePDFValue(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "-"
	}
	return trimmed
}

func escapePDFText(value string) string {
	replacer := strings.NewReplacer(
		"\\", "\\\\",
		"(", "\\(",
		")", "\\)",
		"\n", " ",
		"\r", " ",
		"\t", " ",
	)
	return replacer.Replace(value)
}