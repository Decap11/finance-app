import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * Generates and downloads a beautifully styled PDF Weekly Audit Report for a SACCO group.
 */
export function exportWeeklyReportPDF({ saccoInfo, filterWeek, reportRows, reportTotals, meetingDay = 'Wednesday' }) {
  if (!reportRows || reportRows.length === 0) return;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const saccoName = saccoInfo?.name || 'PEWOSA SACCO Group';
  const groupCode = saccoInfo?.group_code || saccoInfo?.acronym || 'SACCO';
  const generatedAt = new Date().toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short'
  });

  // Colors
  const primaryColor = [37, 59, 142]; // Deep Pewosa Blue (#253b8e)
  const secondaryColor = [16, 185, 129]; // Emerald Green (#10b981)
  const darkTextColor = [30, 41, 59]; // Slate (#1e293b)
  const lightBgColor = [248, 250, 252]; // Light slate (#f8fafc)

  // 1. Header Banner
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, 297, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(saccoName.toUpperCase(), 14, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`GROUP CODE: ${groupCode} | WEEKLY MEMBER AUDIT REPORT`, 14, 21);

  // 2. Metadata Box
  doc.setFillColor(...lightBgColor);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, 32, 269, 18, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...darkTextColor);
  doc.text(`Report Period: Week ${filterWeek}`, 18, 40);
  doc.text(`Meeting Day: ${meetingDay}s`, 90, 40);
  doc.text(`Total Members Recorded: ${reportRows.length}`, 160, 40);
  doc.text(`Generated On: ${generatedAt}`, 215, 40);

  // 3. Table Column Setup
  const tableHeaders = [
    ['Member ID', 'Member Name', 'Shares Qty', 'Shares (Shs)', 'Devt Fund (Shs)', 'Social Fund (Shs)', 'Absenteeism Fines (Shs)', 'Total Collection (Shs)']
  ];

  const tableData = reportRows.map(row => [
    row.memberId || 'N/A',
    row.name || 'Unknown',
    row.sharesQty || 0,
    Number(row.sharesAmt || 0).toLocaleString(),
    Number(row.devtAmt || 0).toLocaleString(),
    Number(row.socialAmt || 0).toLocaleString(),
    Number(row.finesAmt || 0).toLocaleString(),
    Number(row.rowTotal || 0).toLocaleString()
  ]);

  // Add Totals Summary Row
  const totalsRow = [
    'TOTALS',
    'ALL MEMBERS SUMMARY',
    reportRows.reduce((sum, r) => sum + Number(r.sharesQty || 0), 0),
    Number(reportTotals?.shares || 0).toLocaleString(),
    Number(reportTotals?.devt || 0).toLocaleString(),
    Number(reportTotals?.social || 0).toLocaleString(),
    Number(reportTotals?.fines || 0).toLocaleString(),
    Number(reportTotals?.grandTotal || 0).toLocaleString()
  ];

  tableData.push(totalsRow);

  // 4. Render AutoTable
  autoTable(doc, {
    startY: 54,
    head: tableHeaders,
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: primaryColor,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
      halign: 'left'
    },
    bodyStyles: {
      fontSize: 8.5,
      textColor: darkTextColor,
      cellPadding: 2.5
    },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 28 },
      1: { cellWidth: 55 },
      2: { halign: 'center', cellWidth: 22 },
      3: { halign: 'right', cellWidth: 32 },
      4: { halign: 'right', cellWidth: 32 },
      5: { halign: 'right', cellWidth: 32 },
      6: { halign: 'right', cellWidth: 35 },
      7: { halign: 'right', fontStyle: 'bold', cellWidth: 33 }
    },
    didParseCell: (data) => {
      // Highlight the Totals row at bottom
      if (data.row.index === tableData.length - 1) {
        data.cell.styles.fillColor = [241, 245, 249];
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.textColor = primaryColor;
      }
    }
  });

  // 5. Executive Financial Summary Cards (under table)
  const finalY = (doc).lastAutoTable?.finalY || 150;

  if (finalY < 175) {
    doc.setFillColor(239, 246, 255);
    doc.setDrawColor(191, 219, 254);
    doc.roundedRect(14, finalY + 6, 269, 18, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...primaryColor);
    doc.text('EXECUTIVE FINANCIAL COLLECTION SUMMARY', 18, finalY + 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...darkTextColor);
    doc.text(
      `Shares Pool: UGX ${Number(reportTotals?.shares || 0).toLocaleString()}   |   ` +
      `Development: UGX ${Number(reportTotals?.devt || 0).toLocaleString()}   |   ` +
      `Social Fund: UGX ${Number(reportTotals?.social || 0).toLocaleString()}   |   ` +
      `Absenteeism Fines: UGX ${Number(reportTotals?.fines || 0).toLocaleString()}`,
      18, finalY + 19
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
      14, 202
    );
  }

  // 7. Save and Download PDF File
  const filename = `${groupCode}_weekly_report_week_${filterWeek}.pdf`;
  doc.save(filename);
}
