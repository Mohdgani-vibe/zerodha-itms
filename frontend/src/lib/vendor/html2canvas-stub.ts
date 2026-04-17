export default function html2canvasStub() {
  return Promise.reject(new Error('html2canvas support is disabled in this build. Use jsPDF canvas/text APIs instead of doc.html().'));
}