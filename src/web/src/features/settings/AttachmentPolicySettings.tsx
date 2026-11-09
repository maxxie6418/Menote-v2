import { useEffect, useState } from "react";
import { DEFAULT_ATTACHMENT_POLICY, readAttachmentPolicy, updateAttachmentPolicy } from "../../services/attachmentPolicyService";

const MAX_BYTES = DEFAULT_ATTACHMENT_POLICY.maxBytes;

export function AttachmentPolicySettings({ userId }: { userId: string }) {
  const [sizeMiB, setSizeMiB] = useState(String(MAX_BYTES / 1024 / 1024));
  const [extensions, setExtensions] = useState(DEFAULT_ATTACHMENT_POLICY.allowedExtensions.join(", "));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const refresh = () => { void readAttachmentPolicy(userId).then((policy) => {
      setSizeMiB(String(policy.maxBytes / 1024 / 1024));
      setExtensions(policy.allowedExtensions.join(", "));
    }); };
    refresh();
    window.addEventListener("menote:attachment-policy", refresh);
    return () => window.removeEventListener("menote:attachment-policy", refresh);
  }, [userId]);

  const save = async () => {
    const size = Number(sizeMiB);
    if (!Number.isFinite(size) || size < 0.01 || size > 20) { setMessage("单文件上限需在 0.01–20 MiB 之间。"); return; }
    const allowedExtensions = [...new Set(extensions.split(/[\s,，;；]+/).map((extension) => extension.replace(/^\./, "").toLowerCase()).filter(Boolean))];
    if (allowedExtensions.some((extension) => !/^[a-z0-9]{1,12}$/.test(extension))) { setMessage("格式请填写扩展名，例如 png、pdf。"); return; }
    setSaving(true);
    setMessage("");
    try {
      await updateAttachmentPolicy(userId, { maxBytes: Math.floor(size * 1024 * 1024), allowedExtensions });
      setMessage("附件限制已保存并加入同步队列。");
    } catch {
      setMessage("保存失败，请重试。");
    } finally { setSaving(false); }
  };

  return <section className="mn-settings-section" aria-label="附件上传限制">
    <h4>上传限制</h4>
    <p className="mn-sethint">随账号同步并由服务端执行。单文件最大 20 MiB。</p>
    <label className="mn-setrow"><span>单文件上限（MiB）</span>
      <input className="mn-attach-policy-input" type="number" min="0.01" max="20" step="0.01" value={sizeMiB} onChange={(event) => setSizeMiB(event.target.value)} />
    </label>
    <label className="mn-setrow"><span>允许的扩展名</span>
      <input className="mn-attach-policy-input" value={extensions} onChange={(event) => setExtensions(event.target.value)} placeholder="png, jpg, pdf, md" />
    </label>
    <p className="mn-sethint">用逗号或空格分隔；例如 png、jpg、pdf、md。空列表将禁用所有新附件上传。</p>
    <div className="mn-set-actions"><button type="button" className="mn-auth-submit" disabled={saving} onClick={() => void save()}>{saving ? "保存中…" : "保存上传限制"}</button>
      <span role="status">{message}</span></div>
  </section>;
}
