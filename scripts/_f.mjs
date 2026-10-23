import ExcelJS from 'exceljs';
const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(process.argv[2]);
const ws = wb.worksheets[0];
ws.eachRow((r) => r.eachCell((c) => { const v = c.value; if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) { if (c.isMerged && c.master.address !== c.address) return; const f = v.formula ?? v.sharedFormula; if (!/^SUM\(|^[A-Z]+\d+$/.test(f) || process.argv[3]) console.log(c.address, '=', f, '→', v.result instanceof Date ? 'date' : v.result); } else if (v != null && v !== '' && typeof v !== 'object' && process.argv[3]) console.log(c.address, ':', String(v).slice(0, 50)); }));
