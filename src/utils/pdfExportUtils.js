import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * Generates and downloads a beautifully styled A4 Portrait PDF Weekly Audit Report for a SACCO group.
 * Optimized for crisp high-resolution printing and clear legibility of up to 30 members per report page.
 */
export function exportWeeklyReportPDF({ saccoInfo, filterWeek, reportRows, reportTotals, meetingDay = 'Wednesday' }) {
  if (!reportRows || reportRows.length === 0) return;

  // Limit display to max 30 members per report section as requested
  const displayRows = reportRows.slice(0, 30);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const saccoName = saccoInfo?.name || 'PEWOSA SACCO Group';
  const groupCode = saccoInfo?.group_code || saccoInfo?.acronym || 'SACCO';
  const generatedAt = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  // Color Palette
  const primaryColor = [37, 59, 142]; // Deep Pewosa Blue (#253b8e)
  const darkTextColor = [15, 23, 42]; // Dark Slate (#0f172a)
  const lightBgColor = [248, 250, 252]; // Light slate (#f8fafc)

  // 1. Header Banner (210mm width x 26mm height)
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, 210, 26, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(saccoName.toUpperCase(), 10, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`GROUP CODE: ${groupCode} | OFFICIAL WEEKLY MEMBER AUDIT REPORT`, 10, 19);

  // 2. Metadata Box
  doc.setFillColor(...lightBgColor);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(10, 29, 190, 16, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...darkTextColor);
  doc.text(`Report Period: Week ${filterWeek}`, 14, 36);
  doc.text(`Meeting Day: ${meetingDay}s`, 65, 36);
  doc.text(`Members Listed: ${displayRows.length}`, 115, 36);
  doc.text(`Generated: ${generatedAt}`, 155, 36);

  // 3. Table Column Setup
  const tableHeaders = [
    ['Member ID', 'Member Name', 'Shares', 'Shares (Shs)', 'Devt (Shs)', 'Social (Shs)', 'Absent', 'Total (Shs)']
  ];

  const tableData = displayRows.map(row => [
    row.memberId || 'N/A',
    row.name || 'Unknown',
    row.sharesQty || 0,
    Number(row.sharesAmt || 0).toLocaleString(),
    Number(row.devtAmt || 0).toLocaleString(),
    Number(row.socialAmt || 0).toLocaleString(),
    Number(row.finesAmt || 0).toLocaleString(),
    Number(row.rowTotal || 0).toLocaleString()
  ]);

  // Compute Totals Summary Row for displayed members
  const totalsRow = [
    'TOTALS',
    `SUMMARY (${displayRows.length} MEMBERS)`,
    displayRows.reduce((sum, r) => sum + Number(r.sharesQty || 0), 0),
    Number(reportTotals?.shares || displayRows.reduce((sum, r) => sum + Number(r.sharesAmt || 0), 0)).toLocaleString(),
    Number(reportTotals?.devt || displayRows.reduce((sum, r) => sum + Number(r.devtAmt || 0), 0)).toLocaleString(),
    Number(reportTotals?.social || displayRows.reduce((sum, r) => sum + Number(r.socialAmt || 0), 0)).toLocaleString(),
    Number(reportTotals?.fines || displayRows.reduce((sum, r) => sum + Number(r.finesAmt || 0), 0)).toLocaleString(),
    Number(reportTotals?.grandTotal || displayRows.reduce((sum, r) => sum + Number(r.rowTotal || 0), 0)).toLocaleString()
  ];

  tableData.push(totalsRow);

  // 4. Render AutoTable
  autoTable(doc, {
    startY: 48,
    head: tableHeaders,
    body: tableData,
    theme: 'grid',
    margin: { left: 10, right: 10 },
    headStyles: {
      fillColor: primaryColor,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9.5,
      halign: 'left',
      cellPadding: 3
    },
    bodyStyles: {
      fontSize: 9,
      textColor: darkTextColor,
      cellPadding: 2.2
    },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 24 },
      1: { cellWidth: 42 },
      2: { halign: 'center', cellWidth: 16 },
      3: { halign: 'right', cellWidth: 24 },
      4: { halign: 'right', cellWidth: 22 },
      5: { halign: 'right', cellWidth: 22 },
      6: { halign: 'right', cellWidth: 18 },
      7: { halign: 'right', fontStyle: 'bold', cellWidth: 22 }
    },
    didParseCell: (data) => {
      // Highlight the Totals row at bottom
      if (data.row.index === tableData.length - 1) {
        data.cell.styles.fillColor = [241, 245, 249];
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.textColor = primaryColor;
        data.cell.styles.fontSize = 9.5;
      }
    }
  });

  // 5. Executive Financial Summary Card (under table)
  const finalY = (doc).lastAutoTable?.finalY || 230;

  if (finalY < 265) {
    doc.setFillColor(239, 246, 255);
    doc.setDrawColor(191, 219, 254);
    doc.roundedRect(10, finalY + 4, 190, 16, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...primaryColor);
    doc.text('EXECUTIVE FINANCIAL COLLECTION SUMMARY', 14, finalY + 9.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...darkTextColor);
    doc.text(
      `Shares Pool: UGX ${Number(reportTotals?.shares || 0).toLocaleString()}   |   ` +
      `Development: UGX ${Number(reportTotals?.devt || 0).toLocaleString()}   |   ` +
      `Social Fund: UGX ${Number(reportTotals?.social || 0).toLocaleString()}   |   ` +
      `Fines: UGX ${Number(reportTotals?.fines || 0).toLocaleString()}`,
      14, finalY + 15
    );
  }

  // 6. Page Numbers & Footer
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Page ${i} of ${totalPages}  -  Official Financial Audit Report  -  PEWOSA SACCO Engine`,
      10, 290
    );
  }

  // 7. Save and Download PDF File
  const filename = `${groupCode}_weekly_report_week_${filterWeek}.pdf`;
  doc.save(filename);
}
