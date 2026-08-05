import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * Generates and downloads a beautifully styled A4 Portrait PDF Weekly Audit Report for a SACCO group.
 * Optimized for crisp high-resolution printing and clear legibility of up to 30 members per report page.
 *
 * The report is two pages of substance:
 *
 *   1. Contributions -- what every member paid in this week.
 *   2. Lending       -- who took a loan out this week, and who paid one back.
 *
 * The second page is rendered whether or not anything happened, because "no loans were
 * issued in Week 12" is itself a finding an audit meeting needs stated. An absent page
 * reads as an omission; an empty one reads as a fact.
 */
export function exportWeeklyReportPDF({
  saccoInfo,
  filterWeek,
  reportRows,
  reportTotals,
  meetingDay = 'Wednesday',
  loanRows = [],
  repaymentRows = []
}) {
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

  const shs = (value) => Number(value || 0).toLocaleString();

  /** The blue masthead. Repeated on every page so a loose sheet still identifies itself. */
  const drawBanner = (subtitle) => {
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, 210, 26, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(saccoName.toUpperCase(), 10, 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(subtitle, 10, 19);
  };

  // 1. Header Banner (210mm width x 26mm height)
  drawBanner(`GROUP CODE: ${groupCode} | OFFICIAL WEEKLY MEMBER AUDIT REPORT`);

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
  //
  // Absent and Fines are separate columns and must stay that way. "Absent" is what the
  // attendance register produced; "Fines" is every other penalty. Summed together they
  // would answer neither question an audit meeting actually asks.
  const tableHeaders = [
    ['Member ID', 'Member Name', 'Shares', 'Shares (Shs)', 'Devt (Shs)', 'Social (Shs)', 'Absent', 'Fines', 'Total (Shs)']
  ];

  const tableData = displayRows.map(row => [
    row.memberId || 'N/A',
    row.name || 'Unknown',
    row.sharesQty || 0,
    Number(row.sharesAmt || 0).toLocaleString(),
    Number(row.devtAmt || 0).toLocaleString(),
    Number(row.socialAmt || 0).toLocaleString(),
    Number(row.absentAmt || 0).toLocaleString(),
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
    Number(reportTotals?.absent || displayRows.reduce((sum, r) => sum + Number(r.absentAmt || 0), 0)).toLocaleString(),
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
    // Widths total the 190mm of A4 portrait left between the 10mm margins. Re-budgeted
    // when Fines became its own column: the name column gave up most of the space.
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 22 },
      1: { cellWidth: 34 },
      2: { halign: 'center', cellWidth: 14 },
      3: { halign: 'right', cellWidth: 23 },
      4: { halign: 'right', cellWidth: 21 },
      5: { halign: 'right', cellWidth: 21 },
      6: { halign: 'right', cellWidth: 17 },
      7: { halign: 'right', cellWidth: 17 },
      8: { halign: 'right', fontStyle: 'bold', cellWidth: 21 }
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
      `Absence Fines: UGX ${Number(reportTotals?.absent || 0).toLocaleString()}   |   ` +
      `Other Fines: UGX ${Number(reportTotals?.fines || 0).toLocaleString()}`,
      14, finalY + 15
    );
  }

  // 6. Lending Activity Page -- loans issued, and loans repaid, in this same week.
  //
  // Both tables are driven by the ledger rows the contributions table above already reads,
  // matched to the week by the identical rule, so a disbursement cannot land on one week
  // here and another week there.
  doc.addPage();
  drawBanner(`GROUP CODE: ${groupCode} | WEEK ${filterWeek} LENDING ACTIVITY`);

  const loansTotal = loanRows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const repaidTotal = repaymentRows.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  // Net movement, stated plainly. A week that lent more than it collected is the single
  // thing a treasurer most needs to see on this page, and subtracting two figures printed
  // in different tables is exactly the step that gets skipped in a meeting.
  doc.setFillColor(...lightBgColor);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(10, 29, 190, 16, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...darkTextColor);
  doc.text(`Report Period: Week ${filterWeek}`, 14, 36);
  doc.text(`Loans Issued: ${loanRows.length}`, 65, 36);
  doc.text(`Repayments: ${repaymentRows.length}`, 110, 36);
  doc.text(`Net: UGX ${shs(repaidTotal - loansTotal)}`, 155, 36);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Disbursed out: UGX ${shs(loansTotal)}   |   Repaid in: UGX ${shs(repaidTotal)}   |   `
    + 'Net is what lending added to (or drew from) the SACCO pot this week.',
    14, 41.5
  );

  /** One section: a heading, then a table, or a plain sentence when there is nothing. */
  const drawLendingSection = (title, requestedY, headers, rows, columnStyles, totalsRow) => {
    // A busy lending week runs the first table past the bottom of the page, and autoTable
    // then continues on a new one -- but a heading drawn with doc.text() does not follow it,
    // so the repayments title would print in the last few millimetres of the previous page
    // or off it entirely. Anything that cannot fit a heading plus a header row starts fresh.
    let startY = requestedY;
    if (startY > 250) {
      doc.addPage();
      drawBanner(`GROUP CODE: ${groupCode} | WEEK ${filterWeek} LENDING ACTIVITY (CONTINUED)`);
      startY = 38;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...primaryColor);
    doc.text(title, 10, startY);

    if (rows.length === 0) {
      doc.setFillColor(...lightBgColor);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(10, startY + 3, 190, 12, 2, 2, 'FD');

      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(`None recorded in Week ${filterWeek}.`, 14, startY + 10.5);

      return startY + 15;
    }

    // A table long enough to overflow gets its continuation pages from autoTable, not from
    // us, so the banner has to be drawn from inside it -- otherwise a page of loan rows
    // carries nothing naming the SACCO or the week, and a loose sheet from a printed report
    // cannot be identified. Compared against the page the table began on so the banner
    // already drawn above is not painted over.
    const sectionStartPage = doc.getCurrentPageInfo().pageNumber;

    autoTable(doc, {
      startY: startY + 4,
      head: [headers],
      body: [...rows, totalsRow],
      theme: 'grid',
      // top clears the 26mm banner on any continuation page.
      margin: { left: 10, right: 10, top: 34 },
      didDrawPage: () => {
        if (doc.getCurrentPageInfo().pageNumber !== sectionStartPage) {
          drawBanner(`GROUP CODE: ${groupCode} | WEEK ${filterWeek} LENDING ACTIVITY (CONTINUED)`);
        }
      },
      headStyles: {
        fillColor: primaryColor,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
        halign: 'left',
        cellPadding: 2.6
      },
      bodyStyles: {
        fontSize: 8.5,
        textColor: darkTextColor,
        cellPadding: 2.2
      },
      columnStyles,
      didParseCell: (data) => {
        // The totals row is the last body row of this table.
        if (data.section === 'body' && data.row.index === rows.length) {
          data.cell.styles.fillColor = [241, 245, 249];
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = primaryColor;
          data.cell.styles.fontSize = 9;
        }
      }
    });

    return (doc).lastAutoTable?.finalY || startY + 4;
  };

  // 6a. Members who took a loan out this week.
  const loansEndY = drawLendingSection(
    `LOANS ISSUED - WEEK ${filterWeek}`,
    54,
    ['Member ID', 'Member Name', 'Loan Ref', 'Type', 'Purpose', 'Amount (Shs)', 'Status'],
    loanRows.map((row) => [
      row.memberId || 'N/A',
      row.name || 'Unknown',
      row.loanRef || '-',
      row.loanType || 'Normal',
      row.purpose || '-',
      shs(row.amount),
      row.status || '-'
    ]),
    {
      0: { fontStyle: 'bold', cellWidth: 22 },
      1: { cellWidth: 38 },
      2: { cellWidth: 28 },
      3: { cellWidth: 20 },
      4: { cellWidth: 40 },
      5: { halign: 'right', fontStyle: 'bold', cellWidth: 24 },
      6: { cellWidth: 18 }
    },
    ['TOTALS', `${loanRows.length} LOAN(S) ISSUED`, '', '', '', shs(loansTotal), '']
  );

  // 6b. Repayments received against any loan, in the same week.
  drawLendingSection(
    `LOAN REPAYMENTS RECEIVED - WEEK ${filterWeek}`,
    loansEndY + 12,
    ['Member ID', 'Member Name', 'Loan Ref', 'Date', 'Amount Paid (Shs)', 'Balance Now (Shs)', 'Status'],
    repaymentRows.map((row) => [
      row.memberId || 'N/A',
      row.name || 'Unknown',
      row.loanRef || '-',
      row.date || '-',
      shs(row.amount),
      // The loan's outstanding balance as it stands today, not as it stood after this
      // installment -- the ledger does not keep a running balance per repayment. Labelled
      // "Balance Now" in the header so it cannot be read as the latter.
      row.outstanding === null || row.outstanding === undefined ? '-' : shs(row.outstanding),
      row.status || '-'
    ]),
    {
      0: { fontStyle: 'bold', cellWidth: 22 },
      1: { cellWidth: 40 },
      2: { cellWidth: 28 },
      3: { cellWidth: 24 },
      4: { halign: 'right', fontStyle: 'bold', cellWidth: 28 },
      5: { halign: 'right', cellWidth: 28 },
      6: { cellWidth: 20 }
    },
    ['TOTALS', `${repaymentRows.length} REPAYMENT(S)`, '', '', shs(repaidTotal), '', '']
  );

  // 7. Page Numbers & Footer
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

  // 8. Save and Download PDF File
  const filename = `${groupCode}_weekly_report_week_${filterWeek}.pdf`;
  doc.save(filename);
}
