/**
 * GSTR-1 JSON for GST Portal → Returns → GSTR-1 → Prepare Offline → Upload.
 * Field names follow the JSON produced by the GSTN Returns Offline Tool.
 */
import type { Gstr1Item, Gstr1Return } from '../gst-engine/gstr1Builder'
import { toGstnDate } from '../utils/dateFormatter'
import { uqcCode } from '../utils/uqc'
import { downloadBlob } from './download'

export const GSTN_JSON_VERSION = 'GST3.2.4'

function itemDetails(item: Gstr1Item, interstate: boolean) {
  return interstate
    ? { txval: item.txval, rt: item.rt, iamt: item.iamt, csamt: item.csamt }
    : { txval: item.txval, rt: item.rt, camt: item.camt, samt: item.samt, csamt: item.csamt }
}

/** Offline-tool convention: item number = rate × 100 + 1 (e.g. 18% → 1801). */
function itemNumber(rate: number) {
  return Math.round(rate * 100) + 1
}

function items(list: Gstr1Item[], interstate: boolean) {
  return list.map((item) => ({ num: itemNumber(item.rt), itm_det: itemDetails(item, interstate) }))
}

function groupBy<T>(values: T[], key: (value: T) => string) {
  const groups = new Map<string, T[]>()
  for (const value of values) groups.set(key(value), [...(groups.get(key(value)) ?? []), value])
  return groups
}

export function buildGstr1Json(data: Gstr1Return) {
  if (data.blockers.length > 0) {
    throw new Error(`Fix these before exporting:\n• ${data.blockers.join('\n• ')}`)
  }
  const sellerState = data.gstin.slice(0, 2)
  const payload: Record<string, unknown> = {
    gstin: data.gstin,
    fp: data.fp,
    version: GSTN_JSON_VERSION,
    hash: 'hash',
  }

  if (data.b2b.length > 0) {
    payload.b2b = [...groupBy(data.b2b, (invoice) => invoice.ctin ?? '').entries()].map(([ctin, invoices]) => ({
      ctin,
      inv: invoices.map((invoice) => ({
        inum: invoice.number,
        idt: toGstnDate(invoice.date),
        val: invoice.value,
        pos: invoice.pos,
        rchrg: invoice.reverseCharge ? 'Y' : 'N',
        ...(invoice.ecoGstin ? { etin: invoice.ecoGstin } : {}),
        inv_typ: 'R',
        itms: items(invoice.items, invoice.pos !== sellerState),
      })),
    }))
  }

  if (data.b2cl.length > 0) {
    payload.b2cl = [...groupBy(data.b2cl, (invoice) => invoice.pos).entries()].map(([pos, invoices]) => ({
      pos,
      inv: invoices.map((invoice) => ({
        inum: invoice.number,
        idt: toGstnDate(invoice.date),
        val: invoice.value,
        ...(invoice.ecoGstin ? { etin: invoice.ecoGstin } : {}),
        itms: items(invoice.items, true),
      })),
    }))
  }

  if (data.b2cs.length > 0) {
    payload.b2cs = data.b2cs.map((row) => ({
      sply_ty: row.supplyType,
      pos: row.pos,
      typ: row.type,
      ...(row.ecoGstin ? { etin: row.ecoGstin } : {}),
      rt: row.rt,
      txval: row.txval,
      ...(row.supplyType === 'INTER' ? { iamt: row.iamt } : { camt: row.camt, samt: row.samt }),
      csamt: row.csamt,
    }))
  }

  if (data.cdnr.length > 0) {
    payload.cdnr = [...groupBy(data.cdnr, (note) => note.ctin ?? '').entries()].map(([ctin, notes]) => ({
      ctin,
      nt: notes.map((note) => ({
        ntty: note.noteType,
        nt_num: note.number,
        nt_dt: toGstnDate(note.date),
        val: note.value,
        pos: note.pos,
        rchrg: note.reverseCharge ? 'Y' : 'N',
        inv_typ: 'R',
        itms: items(note.items, note.pos !== sellerState),
      })),
    }))
  }

  if (data.cdnur.length > 0) {
    payload.cdnur = data.cdnur.map((note) => ({
      typ: note.urType,
      ntty: note.noteType,
      nt_num: note.number,
      nt_dt: toGstnDate(note.date),
      val: note.value,
      ...(note.urType === 'B2CL' ? { pos: note.pos } : {}),
      itms: items(note.items, true),
    }))
  }

  const hsnEntries = (rows: Gstr1Return['hsnB2b']) => rows.map((row, index) => ({
    hsn_sc: row.hsn,
    num: index + 1,
    desc: row.description,
    uqc: row.uqc === 'NA' ? 'NA' : uqcCode(row.uqc),
    qty: row.qty,
    rt: row.rt,
    txval: row.txval,
    iamt: row.iamt,
    camt: row.camt,
    samt: row.samt,
    csamt: row.csamt,
  }))
  if (data.hsnB2b.length > 0 || data.hsnB2c.length > 0) {
    payload.hsn = {
      hsn_b2b: hsnEntries(data.hsnB2b),
      ...(data.hsnB2c.length > 0 ? { hsn_b2c: hsnEntries(data.hsnB2c) } : {}),
    }
  }

  if (data.docs.length > 0) {
    payload.doc_issue = {
      doc_det: [...groupBy(data.docs, (doc) => String(doc.docNum)).entries()]
        .sort((left, right) => Number(left[0]) - Number(right[0]))
        .map(([docNum, docs]) => ({
          doc_num: Number(docNum),
          doc_typ: docs[0].nature,
          docs: docs.map((doc, index) => ({
            num: index + 1,
            from: doc.from,
            to: doc.to,
            totnum: doc.total,
            cancel: doc.cancelled,
            net_issue: doc.net,
          })),
        })),
    }
  }

  if (data.eco.length > 0) {
    const rows = data.eco.map((row) => ({
      nature: row.nature,
      entry: {
        etin: row.ecoGstin,
        suppval: row.netValue,
        igst: row.igst,
        cgst: row.cgst,
        sgst: row.sgst,
        cess: row.cess,
      },
    }))
    const clttx = rows.filter((row) => row.nature.includes('u/s 52')).map((row) => row.entry)
    const paytx = rows.filter((row) => row.nature.includes('9(5)')).map((row) => row.entry)
    payload.supeco = {
      ...(clttx.length > 0 ? { clttx } : {}),
      ...(paytx.length > 0 ? { paytx } : {}),
    }
  }

  return payload
}

export function gstr1JsonFileName(data: Gstr1Return) {
  return `GSTR1_${data.gstin}_${data.fp}.json`
}

export function downloadGstr1Json(data: Gstr1Return) {
  const payload = buildGstr1Json(data)
  downloadBlob(JSON.stringify(payload), gstr1JsonFileName(data), 'application/json')
}
