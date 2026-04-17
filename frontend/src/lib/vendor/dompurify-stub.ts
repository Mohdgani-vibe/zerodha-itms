const domPurifyStub = {
  sanitize() {
    throw new Error('DOMPurify support is disabled in this build. Use trusted HTML or jsPDF canvas/text APIs instead of doc.html().');
  },
};

export default domPurifyStub;