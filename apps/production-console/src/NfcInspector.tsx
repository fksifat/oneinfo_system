interface NfcReadRecord {
  tnf: number;
  type: string;
  idHex: string;
  payloadHex: string;
  payloadText?: string;
  uri?: string;
}

export interface NfcReadResult {
  uid: string;
  techList: string[];
  ndefFormatted: boolean;
  ndefType?: string;
  writable?: boolean;
  maxSize?: number;
  messageSize?: number;
  records: NfcReadRecord[];
  deviceMetadata: Record<string, unknown>;
  errorCode?: string;
}

export function NfcInspector({ result, onClose }: { result: NfcReadResult; onClose: () => void }) {
  return <section className="panel nfc-inspector">
    <div className="inspector-head"><div><p className="section-label">LIVE TAG INSPECTION</p><h2>NFC tag details</h2></div><span className={result.ndefFormatted ? "tag-state formatted" : "tag-state"}>{result.ndefFormatted ? "NDEF formatted" : "Not NDEF formatted"}</span><button className="secondary" onClick={onClose}>Close details</button></div>
    <div className="tag-facts">
      <div><small>Tag UID</small><strong>{result.uid || "Unavailable"}</strong></div>
      <div><small>NDEF type</small><strong>{result.ndefType ?? "—"}</strong></div>
      <div><small>Writable</small><strong>{result.writable === undefined ? "Unknown" : result.writable ? "Yes" : "No"}</strong></div>
      <div><small>Capacity</small><strong>{result.maxSize === undefined ? "—" : `${result.maxSize} bytes`}</strong></div>
      <div><small>Message size</small><strong>{result.messageSize === undefined ? "—" : `${result.messageSize} bytes`}</strong></div>
      <div><small>Records</small><strong>{result.records.length}</strong></div>
    </div>
    <div className="tech-list"><small>Technologies</small><div>{result.techList.map((tech) => <code key={tech}>{tech.split(".").at(-1)}</code>)}</div></div>
    <div className="ndef-records">
      {result.records.map((record, index) => <article key={`${index}-${record.payloadHex}`}>
        <div><span>Record {index + 1}</span><b>TNF {record.tnf} · {record.type || "Unknown type"}</b></div>
        {record.uri ? <p><small>Resolved URI</small>{/^https?:\/\//i.test(record.uri) ? <a href={record.uri} target="_blank" rel="noreferrer">{record.uri}</a> : <code>{record.uri}</code>}</p> : null}
        {record.payloadText ? <p><small>Text</small><strong>{record.payloadText}</strong></p> : null}
        <p><small>Payload (hex)</small><code>{record.payloadHex || "Empty"}</code></p>
        {record.idHex ? <p><small>Record ID (hex)</small><code>{record.idHex}</code></p> : null}
      </article>)}
      {result.records.length === 0 ? <p className="empty">No NDEF records were found on this tag.</p> : null}
    </div>
    <details><summary>Raw device result</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
  </section>;
}
