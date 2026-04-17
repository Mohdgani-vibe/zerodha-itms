import { useEffect, useMemo, useState } from 'react';
import { BarChart3, FileArchive, FilePlus2, PenSquare } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { getStoredSession } from '../lib/session';

const RECENT_GATEPASS_PAGE_SIZE = 3;

interface GatepassRecord {
  id: string;
  gatepassNumber?: string;
  assetRef: string;
  assetType?: string;
  serialNumber?: string;
  osPlatform?: string;
  expectedReturn?: string;
  assetDescription: string;
  purpose: string;
  originBranch: string;
  recipientBranch: string;
  issueDate: string;
  employeeName: string;
  employeeCode: string;
  departmentName: string;
  contactNumber: string;
  status: string;
  createdAt: string;
  issuerSignedName?: string;
  issuerSignedAt?: string;
  receiverSignedName?: string;
  receiverSignedAt?: string;
  securitySignedName?: string;
  securitySignedAt?: string;
  approverName: string;
  requesterName: string;
  receiverSignedFileName?: string;
  receiverSignedFileContentType?: string;
  receiverSignedFileUploadedAt?: string;
  receiverSignedVerificationStatus?: string;
  receiverSignedVerificationNotes?: string;
  hasReceiverSignedUpload?: boolean;
}

interface PaginatedGatepassResponse {
  items: GatepassRecord[];
  total: number;
  page: number;
  pageSize: number;
  summary?: {
    pending?: number;
    archived?: number;
  };
}

interface LookupOption {
  id: string;
  name: string;
}

interface UserMetaResponse {
  branches: LookupOption[];
  departments: LookupOption[];
}

interface UserOption {
  id: string;
  full_name?: string;
  fullName?: string;
  emp_id?: string;
  employeeCode?: string;
  department?: string | null;
}

interface StockItem {
  id: string;
  itemCode: string;
  category: string;
  name: string;
  serialNumber: string;
  specs: string;
  branchId: string;
  assignedUserId: string;
  warrantyExpiresAt: string;
  status: string;
  createdAt: string;
}

interface PaginatedUsersResponse {
  items: UserOption[];
  total: number;
  page: number;
  pageSize: number;
}

interface PaginatedStockResponse {
  items: StockItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface PaginatedDevicesResponse {
  items: DeviceRecord[];
  total: number;
  page: number;
  pageSize: number;
}

interface DeviceRecord {
  id: string;
  assetId: string;
  hostname: string;
  deviceType?: string;
  osName?: string;
  status: string;
  user?: { fullName?: string; employeeCode?: string } | null;
  branch?: { name?: string } | null;
  department?: { name?: string } | null;
}

interface AssetSuggestion {
  key: string;
  assetRef: string;
  label: string;
  description: string;
  assetType?: string;
  serialNumber?: string;
  osPlatform?: string;
  originBranch: string;
}

interface GatepassForm {
  employeeUserId: string;
  employeeName: string;
  employeeCode: string;
  departmentName: string;
  approverName: string;
  contactNumber: string;
  assetRef: string;
  assetType: string;
  serialNumber: string;
  osPlatform: string;
  expectedReturn: string;
  assetDescription: string;
  purpose: string;
  originBranch: string;
  recipientBranch: string;
  issueDate: string;
}

type GatepassFormErrors = Partial<Record<keyof GatepassForm, string>>;

type GatepassSection = 'create' | 'pending' | 'records' | 'reports';
const PURPOSE_OPTIONS = [
  'Work from home',
  'Branch transfer',
  'Repair / RMA',
  'Vendor handover',
  'Temporary assignment',
  'Other',
] as const;

const formControlClassName = 'w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100';
const formTextareaClassName = 'w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100';

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatDisplayDate(value: string) {
  const normalized = (value || '').trim();
  if (!normalized) {
    return '-';
  }

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return normalized;
  }

  const [, year, month, day] = match;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = monthNames[Number(month) - 1];
  if (!monthLabel) {
    return normalized;
  }

  return `${day}-${monthLabel}-${year}`;
}

function userDisplayName(user: UserOption) {
  return user.fullName || user.full_name || '';
}

function validateGatepassForm(form: GatepassForm): GatepassFormErrors {
  const errors: GatepassFormErrors = {};

  if (!form.originBranch.trim()) {
    errors.originBranch = 'From branch is required';
  }
  if (!form.recipientBranch.trim()) {
    errors.recipientBranch = 'Receiver branch is required';
  }
  if (!form.issueDate.trim()) {
    errors.issueDate = 'Issue date is required';
  }
  if (!form.employeeName.trim()) {
    errors.employeeName = 'Employee name is required';
  }
  if (!form.employeeCode.trim()) {
    errors.employeeCode = 'Employee ID is required';
  }
  if (!form.departmentName.trim()) {
    errors.departmentName = 'Department is required';
  }
  if (!form.approverName.trim()) {
    errors.approverName = 'Approver name is required';
  }
  if (!form.assetRef.trim()) {
    errors.assetRef = 'Asset tag or ID is required';
  }
  if (!form.assetDescription.trim()) {
    errors.assetDescription = 'Asset description is required';
  }
  if (!form.purpose.trim()) {
    errors.purpose = 'Purpose is required';
  }

  return errors;
}

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }
  return <p className="mt-2 text-xs font-medium text-rose-600">{message}</p>;
}

function FieldLabel({ label, required = false }: { label: string; required?: boolean }) {
  return (
    <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">
      {label}
      {required ? <span className="ml-1 text-rose-500">*</span> : null}
    </span>
  );
}

function hasDisplayValue(value?: string) {
  return Boolean(value && value.trim());
}

function fieldDisplayValue(value?: string) {
  return hasDisplayValue(value) ? value!.trim() : '— not filled —';
}

function formatIssueTime(value?: string) {
  const source = value ? new Date(value) : new Date();
  if (Number.isNaN(source.getTime())) {
    return '09:42 AM';
  }

  return source.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).toUpperCase();
}

function initialsFromName(value?: string) {
  const parts = (value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return '??';
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

function PreviewFieldCard({ label, value, strong = false }: { label: string; value?: string; strong?: boolean }) {
  const filled = hasDisplayValue(value);

  return (
    <div className="rounded-[3px] border border-zinc-300 bg-zinc-100 px-2.5 py-2 shadow-[inset_2px_0_0_0_#0d0d0d]">
      <div className="text-[8px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{label}</div>
      <div className={`mt-1 text-[11px] leading-[1.3] ${filled ? `${strong ? 'font-bold' : 'font-medium'} text-zinc-900` : 'italic text-zinc-400'}`}>{fieldDisplayValue(value)}</div>
    </div>
  );
}

function PreviewSignatureCard({ role, name }: { role: string; name?: string }) {
  return (
    <div className="flex min-h-[128px] flex-col rounded-[3px] border border-zinc-300 border-t-[3px] border-t-zinc-950 bg-white px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-zinc-300 bg-zinc-100 text-[9px] font-bold text-zinc-900">
          {initialsFromName(name)}
        </div>
        <div>
          <div className="text-[8px] uppercase tracking-[0.08em] text-zinc-500">{role}</div>
          <div className="mt-0.5 text-[11px] font-bold text-zinc-900">{fieldDisplayValue(name)}</div>
        </div>
      </div>
      <div className="mt-auto flex items-end justify-between border-b border-dashed border-zinc-300 pt-6 pb-1">
        <span className="text-[8px] text-zinc-400">Signature</span>
        <span className="text-[8px] text-zinc-400">Date &amp; time</span>
      </div>
    </div>
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const CODE39_PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn',
};

function normalizeBarcodeValue(value: string) {
  const cleaned = (value || '').trim().toUpperCase();
  if (!cleaned) {
    return 'PENDING';
  }
  return Array.from(cleaned).map((char) => (CODE39_PATTERNS[char] ? char : '-')).join('');
}

function createBarcodeGeometry(value: string) {
  const encoded = `*${normalizeBarcodeValue(value)}*`;
  const narrow = 2;
  const wide = 5;
  const gap = 2;
  const quietZone = 10;
  const bars: Array<{ x: number; width: number }> = [];
  let position = quietZone;

  for (let charIndex = 0; charIndex < encoded.length; charIndex += 1) {
    const pattern = CODE39_PATTERNS[encoded[charIndex]] || CODE39_PATTERNS['-'];
    for (let index = 0; index < pattern.length; index += 1) {
      const width = pattern[index] === 'w' ? wide : narrow;
      if (index % 2 === 0) {
        bars.push({ x: position, width });
      }
      position += width;
    }
    if (charIndex < encoded.length - 1) {
      position += gap;
    }
  }

  return { bars, width: position + quietZone, height: 40 };
}

function BarcodePreview({ value, label, className = '' }: { value: string; label: string; className?: string }) {
  const geometry = createBarcodeGeometry(value);

  return (
    <svg viewBox={`0 0 ${geometry.width} ${geometry.height}`} className={className} aria-label={label} role="img" preserveAspectRatio="xMidYMid meet" shapeRendering="crispEdges">
      {geometry.bars.map((bar) => (
        <rect key={`${label}-${bar.x}`} x={bar.x} y={0} width={bar.width} height={28} fill="#111827" />
      ))}
    </svg>
  );
}

function renderBarcodeSvgMarkup(value: string, label: string) {
  const geometry = createBarcodeGeometry(value);
  const rects = geometry.bars
    .map((bar) => `<rect x="${bar.x}" y="0" width="${bar.width}" height="28" fill="#0d0d0d"></rect>`)
    .join('');

  return `<svg viewBox="0 0 ${geometry.width} ${geometry.height}" aria-label="${escapeHtml(label)}" role="img" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

function draftGatepassNumber(issueDate: string) {
  const normalizedDate = (issueDate || todayDate()).replaceAll('-', '');
  return `ZGP-${normalizedDate}-0001`;
}

function gatepassDisplayNumber(gatepass: Pick<GatepassRecord, 'id' | 'gatepassNumber'>) {
  return gatepass.gatepassNumber || gatepass.id;
}

async function loadJsPdf() {
  const module = await import('jspdf');
  return module.jsPDF;
}

async function buildGatepassPdf(record: Pick<GatepassRecord, 'id' | 'gatepassNumber' | 'assetRef' | 'assetType' | 'serialNumber' | 'osPlatform' | 'expectedReturn' | 'assetDescription' | 'purpose' | 'originBranch' | 'recipientBranch' | 'issueDate' | 'employeeName' | 'employeeCode' | 'departmentName' | 'contactNumber' | 'status' | 'requesterName' | 'approverName' | 'issuerSignedName' | 'securitySignedName' | 'createdAt'>) {
  const jsPDF = await loadJsPdf();
  const document = new jsPDF({ unit: 'pt', format: 'a4' });
  const gatepassNumber = gatepassDisplayNumber(record);
  const issueDateLabel = formatDisplayDate(record.issueDate);
  const issueTimeLabel = formatIssueTime(record.createdAt);
  const expectedReturnLabel = formatDisplayDate(record.expectedReturn || '');
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const left = 36;
  const top = 22;
  const contentWidth = pageWidth - (left * 2);
  const black = [13, 13, 13] as const;
  const dark = [26, 26, 26] as const;
  const grayText = [120, 120, 120] as const;
  const lightGray = [242, 242, 242] as const;
  const borderGray = [204, 204, 204] as const;

  const drawSectionHeader = (index: string, title: string, y: number) => {
    document.setFillColor(...black);
    document.rect(left, y, contentWidth, 13, 'F');
    document.setFont('helvetica', 'bold');
    document.setFontSize(8);
    document.setTextColor(255, 255, 255);
    document.text(`${index}  ·  ${title}`, left + 10, y + 9);
  };

  const drawFieldCard = (label: string, value: string | undefined, x: number, y: number, width: number, height: number, strong = false) => {
    const filled = hasDisplayValue(value);
    document.setFillColor(...lightGray);
    document.setDrawColor(...borderGray);
    document.roundedRect(x, y, width, height, 2, 2, 'FD');
    document.setFillColor(...black);
    document.rect(x, y, 2, height, 'F');

    document.setFont('helvetica', 'bold');
    document.setFontSize(6.5);
    document.setTextColor(...grayText);
    document.text(label, x + 8, y + 10);

    document.setFont('helvetica', strong ? 'bold' : filled ? 'normal' : 'italic');
    document.setFontSize(10.5);
    document.setTextColor(filled ? dark[0] : 170, filled ? dark[1] : 170, filled ? dark[2] : 170);
    const lines = document.splitTextToSize(fieldDisplayValue(value), width - 16);
    document.text(lines.slice(0, 3), x + 8, y + 23);
  };

  const drawSignatureCard = (role: string, name: string | undefined, x: number, y: number, width: number) => {
    document.setFillColor(255, 255, 255);
    document.setDrawColor(187, 187, 187);
    document.roundedRect(x, y, width, 122, 2, 2, 'FD');
    document.setFillColor(...black);
    document.rect(x, y, width, 3, 'F');

    document.setFillColor(232, 232, 232);
    document.circle(x + 20, y + 26, 11, 'F');
    document.setDrawColor(187, 187, 187);
    document.circle(x + 20, y + 26, 11, 'S');
    document.setFont('helvetica', 'bold');
    document.setFontSize(8);
    document.setTextColor(...dark);
    document.text(initialsFromName(name), x + 20, y + 28.5, { align: 'center' });

    document.setFont('helvetica', 'normal');
    document.setFontSize(6.5);
    document.setTextColor(...grayText);
    document.text(role, x + 38, y + 22);
    document.setFont('helvetica', 'bold');
    document.setFontSize(10);
    document.setTextColor(...dark);
    document.text(fieldDisplayValue(name), x + 38, y + 34);

    document.setDrawColor(187, 187, 187);
    document.setLineDashPattern([2, 2], 0);
    document.line(x + 10, y + 101, x + width - 10, y + 101);
    document.setLineDashPattern([], 0);
    document.setFont('helvetica', 'normal');
    document.setFontSize(6.5);
    document.setTextColor(170, 170, 170);
    document.text('Signature', x + 10, y + 110);
    document.text('Date & time', x + width - 10, y + 110, { align: 'right' });
  };

  document.setFillColor(255, 255, 255);
  document.rect(0, 0, pageWidth, pageHeight, 'F');

  document.setFillColor(...black);
  document.rect(left, top, contentWidth, 76, 'F');
  document.setDrawColor(51, 51, 51);
  document.line(left, top + 76, left + contentWidth, top + 76);

  document.setFont('helvetica', 'bold');
  document.setFontSize(24);
  document.setTextColor(255, 255, 255);
  document.text('ZERODHA', left + 14, top + 28);
  document.setFont('helvetica', 'normal');
  document.setFontSize(10);
  document.setTextColor(170, 170, 170);
  document.text('IT GATEPASS', left + 14, top + 48);

  const dividerX = left + 208;
  document.setDrawColor(60, 60, 60);
  document.line(dividerX, top + 16, dividerX, top + 60);

  document.setFont('helvetica', 'bold');
  document.setFontSize(12);
  document.setTextColor(255, 255, 255);
  document.text(gatepassNumber, left + contentWidth - 14, top + 16, { align: 'right' });

  const barcodeGeometry = createBarcodeGeometry(gatepassNumber);
  const barcodeScale = 140 / barcodeGeometry.width;
  const barcodeX = left + contentWidth - 14 - (barcodeGeometry.width * barcodeScale);
  const barcodeY = top + 22;
  document.setFillColor(255, 255, 255);
  document.rect(barcodeX - 6, barcodeY - 3, (barcodeGeometry.width * barcodeScale) + 12, 31, 'F');
  document.setFillColor(...black);
  barcodeGeometry.bars.forEach((bar) => {
    document.rect(barcodeX + (bar.x * barcodeScale), barcodeY, Math.max(bar.width * barcodeScale, 0.7), 24, 'F');
  });

  document.setFont('helvetica', 'normal');
  document.setFontSize(7);
  document.setTextColor(136, 136, 136);
  document.text(`Date of issue: ${issueDateLabel} · ${issueTimeLabel}`, left + contentWidth - 14, top + 66, { align: 'right' });

  let cursorY = top + 88;
  drawSectionHeader('01', 'DISPATCH DETAILS', cursorY);
  cursorY += 19;
  const gap = 10;
  const halfWidth = (contentWidth - gap) / 2;
  drawFieldCard('FROM BRANCH', record.originBranch, left, cursorY, halfWidth, 36, true);
  drawFieldCard('RECEIVER BRANCH', record.recipientBranch, left + halfWidth + gap, cursorY, halfWidth, 36, true);

  cursorY += 50;
  drawSectionHeader('02', 'RECIPIENT DETAILS', cursorY);
  cursorY += 19;
  const tripleGap = 10;
  const tripleWidth = (contentWidth - (tripleGap * 2)) / 3;
  drawFieldCard('EMPLOYEE NAME', record.employeeName, left, cursorY, tripleWidth, 36);
  drawFieldCard('EMPLOYEE ID', record.employeeCode, left + tripleWidth + tripleGap, cursorY, tripleWidth, 36);
  drawFieldCard('DEPARTMENT', record.departmentName, left + ((tripleWidth + tripleGap) * 2), cursorY, tripleWidth, 36);
  cursorY += 46;
  drawFieldCard('APPROVER NAME', record.approverName, left, cursorY, halfWidth, 36);
  drawFieldCard('CONTACT NUMBER', record.contactNumber, left + halfWidth + gap, cursorY, halfWidth, 36);

  cursorY += 50;
  drawSectionHeader('03', 'ASSET DETAILS', cursorY);
  cursorY += 19;
  const quadGap = 8;
  const quadWidth = (contentWidth - (quadGap * 3)) / 4;
  drawFieldCard('ASSET TAG / ID', record.assetRef, left, cursorY, quadWidth, 36);
  drawFieldCard('ASSET TYPE', record.assetType, left + quadWidth + quadGap, cursorY, quadWidth, 36);
  drawFieldCard('SERIAL NUMBER', record.serialNumber, left + ((quadWidth + quadGap) * 2), cursorY, quadWidth, 36);
  drawFieldCard('OS / PLATFORM', record.osPlatform, left + ((quadWidth + quadGap) * 3), cursorY, quadWidth, 36);
  cursorY += 46;
  const tripleInfoWidth = (contentWidth - (tripleGap * 2)) / 3;
  drawFieldCard('PURPOSE', record.purpose, left, cursorY, tripleInfoWidth, 36);
  drawFieldCard('ISSUE DATE', `${issueDateLabel} · ${issueTimeLabel}`, left + tripleInfoWidth + tripleGap, cursorY, tripleInfoWidth, 36);
  drawFieldCard('EXPECTED RETURN', expectedReturnLabel, left + ((tripleInfoWidth + tripleGap) * 2), cursorY, tripleInfoWidth, 36);
  cursorY += 46;
  drawFieldCard('ASSET DESCRIPTION', record.assetDescription, left, cursorY, contentWidth, 42);

  cursorY += 56;
  drawSectionHeader('04', 'AUTHORISATION & SIGNATURES', cursorY);
  cursorY += 18;
  const signatureGap = 10;
  const signatureWidth = (contentWidth - (signatureGap * 2)) / 3;
  drawSignatureCard('ISSUED BY', record.issuerSignedName || record.requesterName || 'ITMS Super Admin', left, cursorY, signatureWidth);
  drawSignatureCard('APPROVED BY', record.approverName || 'Approver', left + signatureWidth + signatureGap, cursorY, signatureWidth);
  drawSignatureCard('SECURITY CHECK', record.securitySignedName || 'Security Guard', left + ((signatureWidth + signatureGap) * 2), cursorY, signatureWidth);

  document.setFillColor(...black);
  document.rect(left, pageHeight - 34, contentWidth, 18, 'F');
  document.setFont('helvetica', 'normal');
  document.setFontSize(6.5);
  document.setTextColor(170, 170, 170);
  document.text('Zerodha Gatepass · Admin & IT Division · iteam@zerodha.com', left + 10, pageHeight - 22);
  document.text(`${gatepassNumber} · ${issueDateLabel}`, left + contentWidth - 10, pageHeight - 22, { align: 'right' });

  return document;
}

async function openGatepassClientPdf(record: Pick<GatepassRecord, 'id' | 'gatepassNumber' | 'assetRef' | 'assetType' | 'serialNumber' | 'osPlatform' | 'expectedReturn' | 'assetDescription' | 'purpose' | 'originBranch' | 'recipientBranch' | 'issueDate' | 'employeeName' | 'employeeCode' | 'departmentName' | 'contactNumber' | 'status' | 'requesterName' | 'approverName' | 'issuerSignedName' | 'securitySignedName' | 'createdAt'>, inline = true) {
  const pdfDocument = await buildGatepassPdf(record);
  if (!inline) {
    pdfDocument.save(`${gatepassDisplayNumber(record)}.pdf`);
    return;
  }

  const blob = pdfDocument.output('blob');
  const objectUrl = URL.createObjectURL(blob);
  const pdfWindow = window.open(objectUrl, '_blank', 'noopener,noreferrer');

  if (!pdfWindow) {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `${gatepassDisplayNumber(record)}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

function openGatepassPrintWindow(record: Pick<GatepassRecord, 'id' | 'gatepassNumber' | 'assetRef' | 'assetType' | 'serialNumber' | 'osPlatform' | 'expectedReturn' | 'assetDescription' | 'purpose' | 'originBranch' | 'recipientBranch' | 'issueDate' | 'employeeName' | 'employeeCode' | 'departmentName' | 'contactNumber' | 'status' | 'requesterName' | 'approverName' | 'issuerSignedName' | 'issuerSignedAt' | 'receiverSignedName' | 'receiverSignedAt' | 'securitySignedName' | 'securitySignedAt' | 'createdAt'>) {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=960,height=900');
  if (!printWindow) {
    return;
  }

  const gatepassNumber = gatepassDisplayNumber(record) || record.assetRef || 'PENDING';
  const issueDateLabel = formatDisplayDate(record.issueDate);
  const issueTimeLabel = formatIssueTime(record.createdAt);
  const expectedReturnLabel = formatDisplayDate(record.expectedReturn || '');
  const barcodeMarkup = renderBarcodeSvgMarkup(gatepassNumber, `Barcode for ${gatepassNumber}`);

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Gatepass ${escapeHtml(gatepassNumber)}</title>
      <style>
        @page { size: A4; margin: 0; }
        * { box-sizing: border-box; }
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; color: #0d0d0d; background: #e5e5e5; padding: 24px; }
        .page { width: 210mm; min-height: 297mm; margin: 0 auto; background: #ffffff; display: flex; flex-direction: column; }
        .header { background: #0d0d0d; padding: 18px 20px 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #333; }
        .header-left { display: flex; flex-direction: column; gap: 4px; }
        .header-title { color: #fff; font-size: 26px; font-weight: 700; line-height: 1; }
        .header-sub { color: #aaa; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; }
        .header-right { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
        .gp-num { color: #fff; font-size: 15px; font-weight: 700; letter-spacing: 0.5px; }
        .gp-date { color: #888; font-size: 10px; }
        .barcode-wrap { background: #fff; padding: 3px 6px; }
        .barcode-wrap svg { display: block; width: 160px; height: 32px; }
        .body { flex: 1; padding: 0 20px; }
        .section-head { background: #0d0d0d; color: #fff; font-size: 10px; font-weight: 700; letter-spacing: 1.5px; padding: 5px 10px; margin-top: 14px; margin-bottom: 10px; }
        .grid-2, .grid-3, .grid-4 { display: grid; gap: 8px; margin-bottom: 8px; }
        .grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .field-card { background: #f2f2f2; border: 0.5px solid #ccc; border-radius: 3px; padding: 7px 10px 8px; box-shadow: inset 2px 0 0 #0d0d0d; }
        .field-label { font-size: 8px; font-weight: 600; color: #777; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
        .field-value { font-size: 11px; color: #0d0d0d; line-height: 1.3; }
        .field-value.strong { font-weight: 700; }
        .field-value.empty { color: #aaa; font-style: italic; }
        .sig-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
        .sig-card { min-height: 120px; border: 0.5px solid #bbb; border-top: 3px solid #0d0d0d; border-radius: 3px; padding: 10px; display: flex; flex-direction: column; }
        .sig-top { display: flex; align-items: center; gap: 8px; }
        .sig-circle { width: 32px; height: 32px; border-radius: 999px; background: #e8e8e8; border: 0.5px solid #bbb; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; }
        .sig-role { font-size: 8px; color: #777; text-transform: uppercase; letter-spacing: 0.5px; }
        .sig-name { font-size: 11px; font-weight: 700; margin-top: 1px; }
        .sig-line { margin-top: auto; padding-top: 24px; padding-bottom: 2px; border-bottom: 1px dashed #bbb; display: flex; justify-content: space-between; }
        .sig-line span { font-size: 8px; color: #aaa; }
        .footer { background: #0d0d0d; padding: 10px 20px; margin-top: 16px; display: flex; align-items: center; justify-content: space-between; }
        .footer span { font-size: 9px; color: #aaa; }
        @media screen and (max-width: 900px) {
          body { padding: 12px; }
          .page { width: 100%; }
          .header { flex-direction: column; align-items: flex-start; }
          .header-right { align-items: flex-start; }
          .grid-2, .grid-3, .grid-4, .sig-grid { grid-template-columns: 1fr; }
        }
        @media print {
          body { padding: 0; background: #ffffff; }
          .page { width: 100%; }
        }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="header">
          <div class="header-left">
            <div class="header-title">ZERODHA</div>
            <div class="header-sub">IT GATEPASS</div>
          </div>
          <div class="header-right">
            <div class="gp-num">${escapeHtml(gatepassNumber)}</div>
            <div class="barcode-wrap">${barcodeMarkup}</div>
            <div class="gp-date">Date of issue: ${escapeHtml(issueDateLabel)} · ${escapeHtml(issueTimeLabel)}</div>
          </div>
        </div>

        <div class="body">
          <div class="section-head">01 · DISPATCH DETAILS</div>
          <div class="grid-2">
            <div class="field-card"><div class="field-label">From Branch</div><div class="field-value strong${hasDisplayValue(record.originBranch) ? '' : ' empty'}">${escapeHtml(fieldDisplayValue(record.originBranch))}</div></div>
            <div class="field-card"><div class="field-label">Receiver Branch</div><div class="field-value strong${hasDisplayValue(record.recipientBranch) ? '' : ' empty'}">${escapeHtml(fieldDisplayValue(record.recipientBranch))}</div></div>
          </div>

          <div class="section-head">02 · RECIPIENT DETAILS</div>
          <div class="grid-3">
            <div class="field-card"><div class="field-label">Employee Name</div><div class="field-value${hasDisplayValue(record.employeeName) ? '' : ' empty'}">${escapeHtml(fieldDisplayValue(record.employeeName))}</div></div>
            <div class="field-card"><div class="field-label">Employee ID</div><div class="field-value${hasDisplayValue(record.employeeCode) ? '' : ' empty'}">${escapeHtml(fieldDisplayValue(record.employeeCode))}</div></div>
            <div class="field-card"><div class="field-label">Department</div><div class="field-value${hasDisplayValue(record.departmentName) ? '' : ' empty'}">${escapeHtml(fieldDisplayValue(record.departmentName))}</div></div>
          </div>
          <div class="grid-2">
            <div class="field-card"><div class="field-label">Approver Name</div><div class="field-value${hasDisplayValue(record.approverName) ? '' : ' empty'}">${escapeHtml(fieldDisplayValue(record.approverName))}</div></div>
            <div class="field-card"><div class="field-label">Contact Number</div><div class="field-value${hasDisplayValue(record.contactNumber) ? '' : ' empty'}">${escapeHtml(fieldDisplayValue(record.contactNumber))}</div></div>
          </div>

          <div class="section-head">03 · ASSET DETAILS</div>
          <div class="grid-4">
            <div class="field-card"><div class="field-label">Asset Tag / ID</div><div class="field-value${hasDisplayValue(record.assetRef) ? '' : ' empty'}">${escapeHtml(fieldDisplayValue(record.assetRef))}</div></div>
            <div class="field-card"><div class="field-label">Asset Type</div><div class="field-value${hasDisplayValue(record.assetType) ? '' : ' empty'}">${escapeHtml(fieldDisplayValue(record.assetType))}</div></div>
            <div class="field-card"><div class="field-label">Serial Number</div><div class="field-value${hasDisplayValue(record.serialNumber) ? '' : ' empty'}">${escapeHtml(fieldDisplayValue(record.serialNumber))}</div></div>
            <div class="field-card"><div class="field-label">OS / Platform</div><div class="field-value${hasDisplayValue(record.osPlatform) ? '' : ' empty'}">${escapeHtml(fieldDisplayValue(record.osPlatform))}</div></div>
          </div>
          <div class="grid-3">
            <div class="field-card"><div class="field-label">Purpose</div><div class="field-value${hasDisplayValue(record.purpose) ? '' : ' empty'}">${escapeHtml(fieldDisplayValue(record.purpose))}</div></div>
            <div class="field-card"><div class="field-label">Issue Date</div><div class="field-value">${escapeHtml(`${issueDateLabel} · ${issueTimeLabel}`)}</div></div>
            <div class="field-card"><div class="field-label">Expected Return</div><div class="field-value${hasDisplayValue(record.expectedReturn) ? '' : ' empty'}">${escapeHtml(fieldDisplayValue(expectedReturnLabel))}</div></div>
          </div>
          <div class="grid-2" style="grid-template-columns:1fr;">
            <div class="field-card"><div class="field-label">Asset Description</div><div class="field-value${hasDisplayValue(record.assetDescription) ? '' : ' empty'}">${escapeHtml(fieldDisplayValue(record.assetDescription))}</div></div>
          </div>

          <div class="section-head">04 · AUTHORISATION &amp; SIGNATURES</div>
          <div class="sig-grid">
            <div class="sig-card">
              <div class="sig-top"><div class="sig-circle">${escapeHtml(initialsFromName(record.issuerSignedName || record.requesterName || 'ITMS Super Admin'))}</div><div><div class="sig-role">Issued by</div><div class="sig-name">${escapeHtml(fieldDisplayValue(record.issuerSignedName || record.requesterName || 'ITMS Super Admin'))}</div></div></div>
              <div class="sig-line"><span>Signature</span><span>Date &amp; time</span></div>
            </div>
            <div class="sig-card">
              <div class="sig-top"><div class="sig-circle">${escapeHtml(initialsFromName(record.approverName || 'Approver'))}</div><div><div class="sig-role">Approved by</div><div class="sig-name">${escapeHtml(fieldDisplayValue(record.approverName || 'Approver'))}</div></div></div>
              <div class="sig-line"><span>Signature</span><span>Date &amp; time</span></div>
            </div>
            <div class="sig-card">
              <div class="sig-top"><div class="sig-circle">${escapeHtml(initialsFromName(record.securitySignedName || 'Security Guard'))}</div><div><div class="sig-role">Security check</div><div class="sig-name">${escapeHtml(fieldDisplayValue(record.securitySignedName || 'Security Guard'))}</div></div></div>
              <div class="sig-line"><span>Signature</span><span>Date &amp; time</span></div>
            </div>
          </div>
        </div>

        <div class="footer">
          <span>Zerodha Gatepass · Admin &amp; IT Division · iteam@zerodha.com</span>
          <span>${escapeHtml(gatepassNumber)} · ${escapeHtml(issueDateLabel)}</span>
        </div>
      </div>
      <script>window.onload = () => window.print();</script>
    </body>
  </html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

export default function Gatepass() {
  const session = getStoredSession();
  const [gatepasses, setGatepasses] = useState<GatepassRecord[]>([]);
  const [branches, setBranches] = useState<LookupOption[]>([]);
  const [departments, setDepartments] = useState<LookupOption[]>([]);
  const [employeeSuggestions, setEmployeeSuggestions] = useState<UserOption[]>([]);
  const [assetSuggestions, setAssetSuggestions] = useState<AssetSuggestion[]>([]);
  const [employeeLookupLoading, setEmployeeLookupLoading] = useState(false);
  const [assetLookupLoading, setAssetLookupLoading] = useState(false);
  const [, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [activeSection, setActiveSection] = useState<GatepassSection>('create');
  const [formErrors, setFormErrors] = useState<GatepassFormErrors>({});
  const [showPreview, setShowPreview] = useState(false);
  const [assetDescriptionLocked, setAssetDescriptionLocked] = useState(false);
  const [gatepassSummary, setGatepassSummary] = useState({ total: 0, pending: 0, archived: 0 });
  const [form, setForm] = useState<GatepassForm>({
    employeeUserId: '',
    employeeName: '',
    employeeCode: '',
    departmentName: '',
    approverName: '',
    contactNumber: '',
    assetRef: '',
    assetType: '',
    serialNumber: '',
    osPlatform: '',
    expectedReturn: '',
    assetDescription: '',
    purpose: PURPOSE_OPTIONS[0],
    originBranch: '',
    recipientBranch: '',
    issueDate: todayDate(),
  });

  const resetForm = (branchOptions: LookupOption[] = branches) => {
    setFormErrors({});
    setShowPreview(false);
    setAssetDescriptionLocked(false);
    setForm({
      employeeUserId: '',
      employeeName: '',
      employeeCode: '',
      departmentName: '',
      approverName: '',
      contactNumber: '',
      assetRef: '',
      assetType: '',
      serialNumber: '',
      osPlatform: '',
      expectedReturn: '',
      assetDescription: '',
      purpose: PURPOSE_OPTIONS[0],
      originBranch: branchOptions[0]?.name || '',
      recipientBranch: branchOptions[1]?.name || branchOptions[0]?.name || '',
      issueDate: todayDate(),
    });
  };

  const loadGatepasses = async () => {
    setLoading(true);
    setError('');
    try {
      const [data, meta] = await Promise.all([
        apiRequest<PaginatedGatepassResponse>(`/api/gatepass?paginate=1&page=1&page_size=${RECENT_GATEPASS_PAGE_SIZE}`),
        apiRequest<UserMetaResponse>('/api/users/meta/options'),
      ]);
      setGatepasses(data.items || []);
      setGatepassSummary({
        total: data.total || 0,
        pending: data.summary?.pending || 0,
        archived: data.summary?.archived || 0,
      });
      setBranches(meta.branches || []);
      setDepartments(meta.departments || []);
      setForm((current) => current.originBranch || current.recipientBranch ? current : {
        ...current,
        originBranch: meta.branches?.[0]?.name || '',
        recipientBranch: meta.branches?.[1]?.name || meta.branches?.[0]?.name || '',
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load gatepasses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadGatepasses();
  }, []);
  const previewGatepassNumber = useMemo(() => draftGatepassNumber(form.issueDate), [form.issueDate]);
  const previewRecord = useMemo<GatepassRecord>(() => ({
    id: previewGatepassNumber,
    gatepassNumber: previewGatepassNumber,
    assetRef: form.assetRef,
    assetType: form.assetType,
    serialNumber: form.serialNumber,
    osPlatform: form.osPlatform,
    expectedReturn: form.expectedReturn,
    assetDescription: form.assetDescription,
    purpose: form.purpose,
    originBranch: form.originBranch,
    recipientBranch: form.recipientBranch,
    issueDate: form.issueDate,
    employeeName: form.employeeName,
    employeeCode: form.employeeCode,
    departmentName: form.departmentName,
    contactNumber: form.contactNumber,
    status: 'pending',
    createdAt: new Date().toISOString(),
    requesterName: session?.user.fullName || form.employeeName,
    approverName: form.approverName,
    issuerSignedName: session?.user.fullName || form.employeeName,
    issuerSignedAt: '',
    receiverSignedName: '',
    receiverSignedAt: '',
    securitySignedName: 'Security Guard',
    securitySignedAt: '',
  }), [
    form.assetDescription,
    form.assetRef,
    form.assetType,
    form.approverName,
    form.contactNumber,
    form.departmentName,
    form.employeeCode,
    form.employeeName,
    form.expectedReturn,
    form.issueDate,
    form.originBranch,
    form.osPlatform,
    form.purpose,
    form.recipientBranch,
    form.serialNumber,
    previewGatepassNumber,
    session?.user.fullName,
  ]);
  const recentGatepasses = useMemo(() => gatepasses, [gatepasses]);

  const sidebarItems = [
    { id: 'create' as const, label: 'Create Gatepass', detail: 'Draft and issue movement pass', icon: FilePlus2 },
    { id: 'pending' as const, label: 'Pending Signatures', detail: 'Awaiting approval, upload, or signoff', icon: PenSquare, badge: gatepassSummary.pending },
    { id: 'records' as const, label: 'Vault & Records', detail: 'Completed and rejected passes', icon: FileArchive },
    { id: 'reports' as const, label: 'Reports', detail: 'Movement and print summary', icon: BarChart3 },
  ];

  const branchNameById = useMemo(() => Object.fromEntries(branches.map((branch) => [branch.id, branch.name])), [branches]);
  const departmentNames = useMemo(() => {
    const names = departments.map((department) => department.name).filter(Boolean);
    if (form.departmentName && !names.includes(form.departmentName)) {
      names.push(form.departmentName);
    }
    return names.sort((left, right) => left.localeCompare(right));
  }, [departments, form.departmentName]);

  useEffect(() => {
    const query = form.employeeName.trim();
    if (query.length < 2) {
      setEmployeeLookupLoading(false);
      setEmployeeSuggestions([]);
      return;
    }

    let cancelled = false;
    setEmployeeLookupLoading(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          paginate: '1',
          page: '1',
          page_size: '20',
          search: query,
          exclude_role: 'super_admin',
        });
        const data = await apiRequest<PaginatedUsersResponse>(`/api/users?${params.toString()}`);
        if (!cancelled) {
          setEmployeeSuggestions((data.items || []).slice().sort((left, right) => userDisplayName(left).localeCompare(userDisplayName(right))));
        }
      } catch {
        if (!cancelled) {
          setEmployeeSuggestions([]);
        }
      } finally {
        if (!cancelled) {
          setEmployeeLookupLoading(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [form.employeeName]);

  useEffect(() => {
    const query = form.assetRef.trim();
    if (query.length < 2) {
      setAssetLookupLoading(false);
      setAssetSuggestions([]);
      return;
    }

    let cancelled = false;
    setAssetLookupLoading(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const searchParams = new URLSearchParams({ paginate: '1', page: '1', page_size: '20', search: query });
        const [stockData, deviceData] = await Promise.all([
          apiRequest<PaginatedStockResponse>(`/api/stock?${searchParams.toString()}`).catch(() => ({ items: [], total: 0, page: 1, pageSize: 20 })),
          apiRequest<PaginatedDevicesResponse>(`/api/devices?${searchParams.toString()}`).catch(() => ({ items: [], total: 0, page: 1, pageSize: 20 })),
        ]);
        if (!cancelled) {
          const deviceAssets = (deviceData.items || []).map((device) => {
            const description = [device.deviceType, device.hostname, device.osName].filter(Boolean).join(' • ');
            return {
              key: `device-${device.id}`,
              assetRef: device.assetId,
              label: `${device.assetId} - ${device.hostname}`,
              description: description || device.hostname || device.assetId,
              assetType: device.deviceType || 'Workstation',
              serialNumber: device.hostname || '',
              osPlatform: device.osName || '',
              originBranch: device.branch?.name || '',
            };
          });
          const stockAssets = (stockData.items || []).map((item) => {
            const description = [item.name, item.category, item.serialNumber || item.specs].filter(Boolean).join(' • ');
            return {
              key: `stock-${item.id}`,
              assetRef: item.itemCode,
              label: `${item.itemCode} - ${item.name}`,
              description: description || item.name || item.itemCode,
              assetType: item.category || item.name || '',
              serialNumber: item.serialNumber || '',
              osPlatform: item.specs || '',
              originBranch: branchNameById[item.branchId] || '',
            };
          });
          setAssetSuggestions([...deviceAssets, ...stockAssets].sort((left, right) => left.label.localeCompare(right.label)));
        }
      } catch {
        if (!cancelled) {
          setAssetSuggestions([]);
        }
      } finally {
        if (!cancelled) {
          setAssetLookupLoading(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [branchNameById, form.assetRef]);

  const handleEmployeeChange = (userId: string) => {
    const selectedUser = employeeSuggestions.find((user) => user.id === userId);
    setFormErrors((current) => ({
      ...current,
      employeeName: undefined,
      employeeCode: undefined,
      departmentName: undefined,
    }));
    setForm((current) => ({
      ...current,
      employeeUserId: userId,
      employeeName: selectedUser?.fullName || selectedUser?.full_name || '',
      employeeCode: selectedUser?.employeeCode || selectedUser?.emp_id || '',
      departmentName: selectedUser?.department || '',
    }));
  };

  const handleEmployeeLookupChange = (value: string) => {
    const normalizedValue = value.trim().toLowerCase();
    const selectedUser = employeeSuggestions.find((user) => {
      const name = userDisplayName(user).trim().toLowerCase();
      const employeeCode = (user.employeeCode || user.emp_id || '').trim().toLowerCase();
      return name === normalizedValue || employeeCode === normalizedValue;
    });

    if (selectedUser) {
      handleEmployeeChange(selectedUser.id);
      return;
    }

    setForm((current) => ({
      ...current,
      employeeUserId: '',
      employeeName: value,
    }));
    setFormErrors((current) => ({
      ...current,
      employeeName: undefined,
    }));
  };

  const handleAssetLookupChange = (value: string) => {
    const normalizedValue = value.trim().toLowerCase();
    const selectedAsset = assetSuggestions.find((asset) => {
      const assetRef = asset.assetRef.trim().toLowerCase();
      const label = asset.label.trim().toLowerCase();
      return assetRef === normalizedValue || label === normalizedValue;
    }) || assetSuggestions.find((asset) => {
      const assetRef = asset.assetRef.trim().toLowerCase();
      const label = asset.label.trim().toLowerCase();
      return assetRef.startsWith(normalizedValue) || label.startsWith(normalizedValue);
    });

    if (selectedAsset) {
      setAssetDescriptionLocked(true);
      setForm((current) => ({
        ...current,
        assetRef: selectedAsset.assetRef,
        assetType: selectedAsset.assetType || current.assetType,
        serialNumber: selectedAsset.serialNumber || current.serialNumber,
        osPlatform: selectedAsset.osPlatform || current.osPlatform,
        assetDescription: selectedAsset.description,
        originBranch: selectedAsset.originBranch || current.originBranch,
      }));
      setFormErrors((current) => ({
        ...current,
        assetRef: undefined,
        assetDescription: undefined,
        originBranch: undefined,
      }));
      return;
    }

    setAssetDescriptionLocked(false);
    setForm((current) => ({
      ...current,
      assetRef: value,
      assetType: current.assetRef === value ? current.assetType : '',
      serialNumber: current.assetRef === value ? current.serialNumber : '',
      osPlatform: current.assetRef === value ? current.osPlatform : '',
      assetDescription: current.assetRef === value ? current.assetDescription : '',
    }));
    setFormErrors((current) => ({
      ...current,
      assetRef: undefined,
      assetDescription: undefined,
    }));
  };

  const updateField = <K extends keyof GatepassForm>(field: K, value: GatepassForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: undefined }));
    if (field === 'assetDescription') {
      setAssetDescriptionLocked(false);
    }
  };

  const openPreview = () => {
    const errors = validateGatepassForm(form);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError('Complete the required gatepass fields before previewing the draft.');
      return;
    }
    setError('');
    setShowPreview(true);
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors = validateGatepassForm(form);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError('Complete the required gatepass fields before generating the gatepass.');
      return;
    }
    try {
      setSubmitting(true);
      setError('');
      setSuccessMessage('');
      const created = await apiRequest<{ id: string; gatepassNumber?: string }>('/api/gatepass', {
        method: 'POST',
        body: JSON.stringify({
          assetRef: form.assetRef,
          assetDescription: form.assetDescription,
          purpose: form.purpose,
          originBranch: form.originBranch,
          recipientBranch: form.recipientBranch,
          issueDate: form.issueDate,
          employeeName: form.employeeName,
          employeeCode: form.employeeCode,
          departmentName: form.departmentName,
          approverName: form.approverName,
          contactNumber: form.contactNumber,
        }),
      });
      const createdRecord: GatepassRecord = {
        ...previewRecord,
        id: created.id,
        gatepassNumber: created.gatepassNumber || previewRecord.gatepassNumber || created.id,
        createdAt: new Date().toISOString(),
      };
      await openGatepassClientPdf(createdRecord, false);
      resetForm();
      await loadGatepasses();
      setSuccessMessage(`Gatepass ${created.gatepassNumber || created.id} generated successfully.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to create gatepass');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="gatepass-page w-full space-y-6">
      {showPreview ? (
        <div className="gatepass-preview-overlay fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/70 p-4 print:bg-white print:p-0">
          <div className="gatepass-print-sheet max-h-[90vh] w-full max-w-[210mm] overflow-y-auto rounded-xl bg-white shadow-2xl print:max-h-none print:max-w-none print:overflow-visible print:rounded-none print:shadow-none">
            <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-5 py-4">
              <div>
                <div className="text-[2rem] font-bold leading-none tracking-[-0.03em] text-white">ZERODHA</div>
                <div className="mt-2 text-[11px] uppercase tracking-[0.08em] text-zinc-400">IT GATEPASS</div>
              </div>
              <div className="text-right">
                <div className="text-[15px] font-bold tracking-[0.03em] text-white">{previewGatepassNumber}</div>
                <div className="mt-2 inline-flex bg-white px-2 py-1">
                  <BarcodePreview value={previewGatepassNumber} label={`Barcode for ${previewGatepassNumber}`} className="h-8 w-40" />
                </div>
                <div className="mt-2 text-[10px] text-zinc-400">Date of issue: {formatDisplayDate(previewRecord.issueDate)} · {formatIssueTime(previewRecord.createdAt)}</div>
              </div>
            </div>

            <div className="space-y-3 px-5 pb-5">
              <section>
                <div className="mt-4 bg-zinc-950 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-white">01 · Dispatch Details</div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <PreviewFieldCard label="From Branch" value={previewRecord.originBranch} strong />
                  <PreviewFieldCard label="Receiver Branch" value={previewRecord.recipientBranch} strong />
                </div>
              </section>

              <section>
                <div className="bg-zinc-950 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-white">02 · Recipient Details</div>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  <PreviewFieldCard label="Employee Name" value={previewRecord.employeeName} />
                  <PreviewFieldCard label="Employee ID" value={previewRecord.employeeCode} />
                  <PreviewFieldCard label="Department" value={previewRecord.departmentName} />
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <PreviewFieldCard label="Approver Name" value={previewRecord.approverName} />
                  <PreviewFieldCard label="Contact Number" value={previewRecord.contactNumber} />
                </div>
              </section>

              <section>
                <div className="bg-zinc-950 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-white">03 · Asset Details</div>
                <div className="mt-2 grid gap-2 md:grid-cols-4">
                  <PreviewFieldCard label="Asset Tag / ID" value={previewRecord.assetRef} />
                  <PreviewFieldCard label="Asset Type" value={previewRecord.assetType} />
                  <PreviewFieldCard label="Serial Number" value={previewRecord.serialNumber} />
                  <PreviewFieldCard label="OS / Platform" value={previewRecord.osPlatform} />
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  <PreviewFieldCard label="Purpose" value={previewRecord.purpose} />
                  <PreviewFieldCard label="Issue Date" value={`${formatDisplayDate(previewRecord.issueDate)} · ${formatIssueTime(previewRecord.createdAt)}`} />
                  <PreviewFieldCard label="Expected Return" value={formatDisplayDate(previewRecord.expectedReturn || '')} />
                </div>
                <div className="mt-2">
                  <PreviewFieldCard label="Asset Description" value={previewRecord.assetDescription} />
                </div>
              </section>

              <section>
                <div className="bg-zinc-950 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-white">04 · Authorisation &amp; Signatures</div>
                <div className="mt-2 grid gap-2.5 md:grid-cols-3">
                  <PreviewSignatureCard role="Issued by" name={previewRecord.issuerSignedName || previewRecord.requesterName || 'ITMS Super Admin'} />
                  <PreviewSignatureCard role="Approved by" name={previewRecord.approverName || 'Approver'} />
                  <PreviewSignatureCard role="Security check" name={previewRecord.securitySignedName || 'Security Guard'} />
                </div>
              </section>
            </div>

            <div className="flex items-center justify-between bg-zinc-950 px-5 py-2.5 text-[9px] text-zinc-400">
              <span>Zerodha Gatepass · Admin &amp; IT Division · iteam@zerodha.com</span>
              <span>{previewGatepassNumber} · {formatDisplayDate(previewRecord.issueDate)}</span>
            </div>

            <div className="gatepass-preview-actions flex flex-wrap justify-end gap-3 border-t border-zinc-200 px-6 py-4">
              <button type="button" onClick={() => setShowPreview(false)} className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-700 hover:bg-zinc-50">
                Back to Edit
              </button>
              <button
                type="button"
                onClick={() => void openGatepassClientPdf(previewRecord, false)}
                className="rounded-lg border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800"
              >
                Download PDF
              </button>
              <button type="button" onClick={() => openGatepassPrintWindow(previewRecord)} className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-bold text-zinc-700 hover:bg-zinc-100">
                Print Preview
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div>
        <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Gatepass</h1>
        <p className="mt-1 text-sm text-zinc-500">Admin and IT dispatch tracking with creation, pending signatures, saved PDFs, and reporting.</p>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}
      {successMessage ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{successMessage}</div> : null}

      <div className="grid items-start gap-6 md:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm md:sticky md:top-6">
          <div>
            <div className="text-lg font-bold text-zinc-900">Gatepass Pro</div>
            <p className="mt-1 text-sm text-zinc-500">Dispatch and tracking</p>
          </div>

          <div className="mt-5 space-y-2">
            {sidebarItems.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className={`flex w-full items-start justify-between rounded-xl border px-3 py-3 text-left transition ${active ? 'border-zinc-300 bg-zinc-50 text-zinc-900' : 'border-transparent text-zinc-700 hover:border-zinc-200 hover:bg-zinc-50'}`}
                >
                  <div className="flex gap-3">
                    <Icon className={`mt-0.5 h-4 w-4 ${active ? 'text-zinc-700' : 'text-zinc-400'}`} />
                    <div>
                      <div className="text-sm font-bold">{item.label}</div>
                      <div className="mt-1 text-xs text-zinc-500">{item.detail}</div>
                    </div>
                  </div>
                  {typeof item.badge === 'number' && item.badge > 0 ? <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-bold text-zinc-700">{item.badge}</span> : null}
                </button>
              );
            })}
          </div>

        </aside>

        <div className="min-w-0 space-y-5">
        {activeSection === 'reports' ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Scan Station</div>
                  <div className="mt-2 text-2xl font-bold text-zinc-900">Gatepass barcode board</div>
                  <div className="mt-2 text-sm text-zinc-500">Use these larger barcode cards to verify movement records quickly from reports.</div>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  {recentGatepasses.map((gatepass) => (
                    <div key={`scan-station-${gatepass.id}`} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">{gatepass.status}</div>
                      <div className="mt-2 text-sm font-semibold text-zinc-900">{gatepassDisplayNumber(gatepass)}</div>
                      <BarcodePreview value={gatepassDisplayNumber(gatepass)} label={`Barcode for ${gatepassDisplayNumber(gatepass)}`} className="mt-4 h-16 w-full" />
                      <div className="mt-3 text-xs text-zinc-500">{gatepass.employeeName || gatepass.assetRef || 'Gatepass record'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Created</div>
                <div className="mt-3 text-3xl font-bold text-zinc-900">{gatepassSummary.total}</div>
                <div className="mt-2 text-sm text-zinc-500">All gatepasses issued from this portal.</div>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Pending</div>
                <div className="mt-3 text-3xl font-bold text-amber-600">{gatepassSummary.pending}</div>
                <div className="mt-2 text-sm text-zinc-500">Awaiting approval, print, or signature completion.</div>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Archived</div>
                <div className="mt-3 text-3xl font-bold text-zinc-900">{gatepassSummary.archived}</div>
                <div className="mt-2 text-sm text-zinc-500">Approved and rejected records in the vault.</div>
              </div>
            </div>
          </div>
        ) : null}

        {activeSection === 'create' ? (
        <form onSubmit={handleCreate} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-zinc-900">Draft New Gatepass</h2>
              <p className="mt-0.5 text-sm text-zinc-500">Capture branch transfer details and issue the official gatepass.</p>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 bg-white text-xs font-bold text-zinc-700">01</div>
              <div>
                <div className="text-sm font-bold text-zinc-900">Dispatch Details</div>
                <div className="mt-0.5 text-xs text-zinc-500">Set the branch and issue date for this movement pass.</div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-12">
              <div className="xl:col-span-6">
                <label>
                  <FieldLabel label="From Branch" required />
                </label>
                <select value={form.originBranch} onChange={(event) => updateField('originBranch', event.target.value)} className={formControlClassName}>
                  {branches.map((branch) => <option key={`origin-${branch.id}`} value={branch.name}>{branch.name}</option>)}
                </select>
                <FieldError message={formErrors.originBranch} />
              </div>

              <div className="xl:col-span-6">
                <label>
                  <FieldLabel label="Receiver Branch" required />
                </label>
                <select value={form.recipientBranch} onChange={(event) => updateField('recipientBranch', event.target.value)} className={formControlClassName}>
                  {branches.map((branch) => <option key={`recipient-${branch.id}`} value={branch.name}>{branch.name}</option>)}
                </select>
                <FieldError message={formErrors.recipientBranch} />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 bg-white text-xs font-bold text-zinc-700">02</div>
              <div>
                <div className="text-sm font-bold text-zinc-900">Recipient Details</div>
                <div className="mt-0.5 text-xs text-zinc-500">Identify who is taking the asset and who approves the movement.</div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-10">
              <div className="xl:col-span-4">
                <label>
                  <FieldLabel label="Employee Name" required />
                </label>
                <>
                  <input
                    list="gatepass-employee-suggestions"
                    value={form.employeeName}
                    onChange={(event) => handleEmployeeLookupChange(event.target.value)}
                    className={formControlClassName}
                    placeholder="Search by employee name or ID"
                  />
                  <datalist id="gatepass-employee-suggestions">
                    {employeeSuggestions.map((user) => {
                      const name = userDisplayName(user);
                      const code = user.employeeCode || user.emp_id || '';
                      return <option key={user.id} value={name}>{code ? `${name} - ${code}` : name}</option>;
                    })}
                  </datalist>
                </>
                {!formErrors.employeeName ? (
                  <p className="mt-2 text-[11px] text-zinc-500">
                    {form.employeeName.trim().length < 2
                      ? 'Type at least 2 characters to search employees.'
                      : employeeLookupLoading
                        ? 'Searching employees...'
                        : employeeSuggestions.length > 0
                          ? `${employeeSuggestions.length} employee suggestion${employeeSuggestions.length === 1 ? '' : 's'} ready.`
                          : 'No employee matches found for this search.'}
                  </p>
                ) : null}
                <FieldError message={formErrors.employeeName} />
              </div>
              <div className="xl:col-span-3">
                <label>
                  <FieldLabel label="Employee ID" required />
                </label>
                <input value={form.employeeCode} onChange={(event) => updateField('employeeCode', event.target.value)} className={formControlClassName} placeholder="Employee code" />
                <FieldError message={formErrors.employeeCode} />
              </div>
              <div className="xl:col-span-3">
                <label>
                  <FieldLabel label="Department" required />
                </label>
                <select value={form.departmentName} onChange={(event) => updateField('departmentName', event.target.value)} className={formControlClassName}>
                  <option value="">Select department</option>
                  {departmentNames.map((departmentName) => <option key={departmentName} value={departmentName}>{departmentName}</option>)}
                </select>
                <FieldError message={formErrors.departmentName} />
              </div>
              <div className="xl:col-span-5">
                <label>
                  <FieldLabel label="Approver Name" required />
                </label>
                <input value={form.approverName} onChange={(event) => updateField('approverName', event.target.value)} className={formControlClassName} placeholder="Approver name" />
                <FieldError message={formErrors.approverName} />
              </div>
              <div className="xl:col-span-5">
                <label>
                  <FieldLabel label="Contact Number" />
                </label>
                <input value={form.contactNumber} onChange={(event) => updateField('contactNumber', event.target.value)} className={formControlClassName} placeholder="Contact number" />
                <FieldError message={formErrors.contactNumber} />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 bg-white text-xs font-bold text-zinc-700">03</div>
              <div>
                <div className="text-sm font-bold text-zinc-900">Asset Details</div>
                <div className="mt-0.5 text-xs text-zinc-500">Choose the asset, complete the hardware details, and set the movement dates.</div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-10">
              <div className="xl:col-span-4">
                <label>
                  <FieldLabel label="Asset Tag / ID" required />
                </label>
                <>
                  <input list="gatepass-asset-suggestions" value={form.assetRef} onChange={(event) => handleAssetLookupChange(event.target.value)} className={formControlClassName} placeholder="Start typing asset tag, stock code, or hostname" />
                  <datalist id="gatepass-asset-suggestions">
                    {assetSuggestions.map((asset) => <option key={asset.key} value={asset.assetRef}>{asset.label}</option>)}
                  </datalist>
                </>
                <p className="mt-2 text-[11px] text-zinc-500">
                  {form.assetRef.trim().length < 2
                    ? 'Type at least 2 characters to search devices and stock assets. A known asset auto-fills the hardware fields and from branch.'
                    : assetLookupLoading
                      ? 'Searching assets...'
                      : assetSuggestions.length > 0
                        ? `${assetSuggestions.length} asset suggestion${assetSuggestions.length === 1 ? '' : 's'} ready. Choosing a known asset auto-fills the hardware fields and from branch.`
                        : 'No asset matches found for this search.'}
                </p>
                <FieldError message={formErrors.assetRef} />
              </div>
              <div className="xl:col-span-2">
                <label>
                  <FieldLabel label="Asset Type" />
                </label>
                <input value={form.assetType} onChange={(event) => updateField('assetType', event.target.value)} className={formControlClassName} placeholder="Workstation" />
              </div>
              <div className="xl:col-span-4">
                <label>
                  <FieldLabel label="Serial Number" />
                </label>
                <input value={form.serialNumber} onChange={(event) => updateField('serialNumber', event.target.value)} className={formControlClassName} placeholder="Serial or hostname" />
              </div>
              <div className="xl:col-span-3">
                <label>
                  <FieldLabel label="OS / Platform" />
                </label>
                <input value={form.osPlatform} onChange={(event) => updateField('osPlatform', event.target.value)} className={formControlClassName} placeholder="Ubuntu 24.04 LTS" />
              </div>
              <div className="xl:col-span-3">
                <label>
                  <FieldLabel label="Purpose" required />
                </label>
                <select value={form.purpose} onChange={(event) => updateField('purpose', event.target.value)} className={formControlClassName}>
                  {PURPOSE_OPTIONS.map((purpose) => <option key={purpose} value={purpose}>{purpose}</option>)}
                </select>
                <FieldError message={formErrors.purpose} />
              </div>
              <div className="xl:col-span-2">
                <label>
                  <FieldLabel label="Issue Date" required />
                </label>
                <input type="date" value={form.issueDate} onChange={(event) => updateField('issueDate', event.target.value)} className={formControlClassName} />
                <p className="mt-1.5 text-[11px] text-zinc-500">Displays as {formatDisplayDate(form.issueDate)}.</p>
                <FieldError message={formErrors.issueDate} />
              </div>
              <div className="xl:col-span-2">
                <label>
                  <FieldLabel label="Expected Return" />
                </label>
                <input type="date" value={form.expectedReturn} onChange={(event) => updateField('expectedReturn', event.target.value)} className={formControlClassName} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <label>
                  <FieldLabel label="Asset Description" required />
                </label>
                {assetDescriptionLocked ? <button type="button" onClick={() => setAssetDescriptionLocked(false)} className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-700">Unlock Edit</button> : null}
              </div>
              <textarea value={form.assetDescription} readOnly={assetDescriptionLocked} onChange={(event) => updateField('assetDescription', event.target.value)} rows={3} className={`${formTextareaClassName} ${assetDescriptionLocked ? 'border-zinc-300 bg-zinc-100 text-zinc-600 focus:border-zinc-300 focus:ring-0' : ''}`} placeholder="Describe the asset being moved" />
              {assetDescriptionLocked ? <p className="mt-1.5 text-[11px] text-zinc-500">Description came from the matched inventory record. Unlock edit if you need to override it.</p> : null}
              <FieldError message={formErrors.assetDescription} />
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <button type="button" onClick={() => resetForm()} className="self-start rounded-lg px-1 py-1 text-sm font-semibold text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700">
                Clear Form
              </button>
              <div className="grid w-full gap-2.5 md:w-auto md:min-w-[360px] md:grid-cols-2">
                <button type="button" onClick={openPreview} className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-700 hover:bg-zinc-50">
                Preview Draft
                </button>
                <button type="submit" disabled={submitting} className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60">
                {submitting ? 'Generating...' : 'Generate Official Gatepass'}
                </button>
              </div>
            </div>
          </div>
        </form>
        ) : null}

        {activeSection !== 'create' ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-zinc-900">
            {activeSection === 'pending' ? 'Pending Signatures' : activeSection === 'records' ? 'Vault & Records' : 'Gatepass Register'}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {activeSection === 'pending' ? 'Review gatepasses that still need approval, receiver upload, or security signoff.' : activeSection === 'records' ? 'Browse completed and rejected gatepasses already processed.' : 'Search all generated gatepasses.'}
          </p>
        </div>
        ) : null}

        {activeSection === 'pending' ? <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-sm">Pending signatures are managed from the side menu only.</div> : null}
        {activeSection === 'records' ? <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-sm">Saved gatepass records are hidden from the main page.</div> : null}
        </div>
      </div>
    </div>
  );
}