import { useEffect, useMemo, useState } from "react";
import type { Interview, Question, Questionnaire, Stakeholder, AnswerValue, T2Item, AdditionalContact } from "../types";
import {
  isRequired,
  setAnswer,
  shouldShow,
  shouldShowBarriers,
  tier1Missing,
  tier2Missing,
  barriersMissing,
  hasStraightLineTier1,
  hasStraightLineTier2,
  progressPercent,
} from "../lib/interview";
import { saveInterview, captureGps } from "../lib/storage";

interface Props {
  stakeholder: Stakeholder;
  interview: Interview;
  questionnaire: Questionnaire;
  onBack: () => void;
  onSubmitted: () => void;
}

/** Auto-save on every change, debounced. */
function useAutosave(iv: Interview) {
  useEffect(() => {
    const t = setTimeout(() => {
      saveInterview(iv).catch(console.error);
    }, 400);
    return () => clearTimeout(t);
  }, [iv]);
}

/** Renders one Tier 1 question. */
function QuestionView({
  q,
  iv,
  update,
  error,
}: {
  q: Question;
  iv: Interview;
  update: (code: string, v: AnswerValue) => void;
  error?: string;
}) {
  const v = iv.answers[q.code];
  const req = isRequired(q, iv);

  if (!shouldShow(q.code, iv)) return null;

  let input: React.ReactNode = null;

  if (q.type === "text") {
    if (q.code.endsWith("_detail") || q.code === "B02_note") {
      input = (
        <textarea
          value={(v as string) ?? ""}
          onChange={(e) => update(q.code, e.target.value)}
          placeholder={q.notes || "Type answer…"}
        />
      );
    } else {
      input = (
        <input
          type="text"
          value={(v as string) ?? ""}
          onChange={(e) => update(q.code, e.target.value)}
          placeholder={q.notes || ""}
        />
      );
    }
  } else if (q.type === "date") {
    const today = new Date().toISOString().slice(0, 10);
    input = (
      <input
        type="date"
        value={(v as string) ?? today}
        max={today}
        onChange={(e) => update(q.code, e.target.value)}
      />
    );
  } else if (q.type === "likert5") {
    input = (
      <>
        <div className="likert">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={`lbtn${v === n ? " selected" : ""}`}
              onClick={() => update(q.code, n)}
            >
              {n}
            </button>
          ))}
        </div>
        {q.options.length >= 5 && (
          <div className="likert-labels">
            <span>{q.options[0].label.replace(/^1\s*=\s*/, "")}</span>
            <span>{q.options[4].label.replace(/^5\s*=\s*/, "")}</span>
          </div>
        )}
      </>
    );
  } else if (q.type === "single") {
    input = (
      <div className="options">
        {q.options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`option-btn${v === o.value ? " selected" : ""}`}
            onClick={() => update(q.code, o.value)}
          >
            <span className="dot" />
            <span>{o.label}</span>
          </button>
        ))}
      </div>
    );
  } else if (q.type === "auto") {
    input = (
      <div className="small muted">
        (Auto-filled: <b>{(v as string) || "—"}</b>)
      </div>
    );
  } else if (q.type === "stakeholder_picker") {
    input = (
      <div className="small muted">Institution is pre-selected from the stakeholder list.</div>
    );
  }

  return (
    <div className="question">
      <div className="label">
        <span className="section-code">{q.code}</span>
        {q.text}
        {req && <span className="req">*</span>}
      </div>
      {input}
      {q.notes && q.type !== "text" && <div className="notes">{q.notes}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

export function InterviewScreen({ stakeholder, interview, questionnaire, onBack, onSubmitted }: Props) {
  const [iv, setIv] = useState<Interview>(interview);
  const [stepIdx, setStepIdx] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitWarn, setSubmitWarn] = useState<string | null>(null);

  useAutosave(iv);

  // On first open: capture GPS silently + auto-fill today's date if not set
  useEffect(() => {
    (async () => {
      let updated = { ...iv };
      let changed = false;

      // Ensure new fields exist for older saved interviews
      if (updated.respondent_email === undefined) { updated = { ...updated, respondent_email: "" }; changed = true; }
      if (updated.respondent_phone === undefined) { updated = { ...updated, respondent_phone: "" }; changed = true; }
      if (updated.additional_contacts === undefined) { updated = { ...updated, additional_contacts: [] }; changed = true; }
      if (updated.enumerator_comments === undefined) { updated = { ...updated, enumerator_comments: "" }; changed = true; }
      
      // Auto-fill interview date if not already set
      if (!updated.answers["A07"]) {
        const today = new Date().toISOString().slice(0, 10);
        updated = { ...updated, answers: { ...updated.answers, A07: today } };
        changed = true;
      }

      // Capture GPS if not already captured for this interview
      if (!updated.gps) {
        const gps = await captureGps();
        if (gps) {
          updated = { ...updated, gps };
          changed = true;
        }
      }

      if (changed) {
        setIv(updated);
        await saveInterview(updated);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const steps = useMemo(
    () => [
      ...questionnaire.sections.filter((s) => s.code !== "G").map((s) => ({ kind: "t1" as const, section: s })),
      { kind: "t2" as const },
      { kind: "barriers" as const, section: questionnaire.sections.find((s) => s.code === "G")! },
      { kind: "contacts" as const },
      { kind: "review" as const },
    ],
    [questionnaire],
  );

  const step = steps[stepIdx];
  const progress = progressPercent(
    questionnaire.sections.flatMap((s) => s.questions),
    iv,
  );

  const update = (code: string, v: AnswerValue) =>
    setIv((prev) => setAnswer(prev, code, v));

  const updateT2 = (index: number, patch: Partial<T2Item>) =>
    setIv((prev) => ({
      ...prev,
      t2_items: prev.t2_items.map((it) => (it.index === index ? { ...it, ...patch } : it)),
      updatedAt: new Date().toISOString(),
    }));

  /** Validate the currently visible step before allowing Next. */
  function validateCurrentStep(): boolean {
    const errs: Record<string, string> = {};
    if (step.kind === "t1") {
      for (const q of step.section.questions) {
        if (!isRequired(q, iv)) continue;
        if (q.type === "auto") continue;
        const v = iv.answers[q.code];
        if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
          errs[q.code] = "Required";
        }
      }
    } else if (step.kind === "t2") {
      const m = tier2Missing(iv);
      if (m.length) errs._t2 = `Please complete ${m.length} item(s) before continuing.`;
    } else if (step.kind === "barriers") {
      if (shouldShowBarriers(iv) && iv.barriers.length === 0) {
        errs._bar = "Please select at least one barrier, or go back and mark all Tier 2 items as Fully Implemented.";
      }
      if (iv.barriers.includes(12) && !iv.barrier_other.trim()) {
        errs._bar_oth = "Please specify the 'Other' barrier.";
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const next = () => {
    if (!validateCurrentStep()) return;
    setStepIdx((i) => Math.min(i + 1, steps.length - 1));
    window.scrollTo(0, 0);
  };
  const prev = () => {
    setErrors({});
    setStepIdx((i) => Math.max(i - 1, 0));
    window.scrollTo(0, 0);
  };

  async function submit() {
    // Hard validation: all required fields across all sections
    const allT1 = questionnaire.sections.flatMap((s) => s.questions);
    const missingT1 = tier1Missing(allT1, iv);
    const missingT2 = tier2Missing(iv);
    const missingBar = barriersMissing(iv);
    const missing = [...missingT1, ...missingT2, ...missingBar];
    if (missing.length) {
      setSubmitWarn(`Cannot submit — ${missing.length} required field(s) missing: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}`);
      return;
    }
    const done: Interview = {
      ...iv,
      status: "completed",
      completedAt: iv.completedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveInterview(done);
    onSubmitted();
  }

  return (
    <div>
      <div className="interview-intro">
        <h2>#{stakeholder.id} — {stakeholder.name}</h2>
        <div className="meta">
          Enumerator {iv.enumerator} · Interview ID {iv.id.slice(-6)} · {iv.status === "draft" ? "Draft" : "Completed"}
        </div>
      </div>

      <div className="progress-bar">
        <div style={{ width: `${progress}%` }} />
      </div>
      <div className="progress-text">
        Step {stepIdx + 1} of {steps.length} · {progress}% complete
      </div>

      {step.kind === "t1" && (
        <div>
          <div className="section-title">
            <span className="section-code">{step.section.code}</span>
            {step.section.title}
          </div>
          {step.section.questions.map((q) => (
            <QuestionView key={q.code} q={q} iv={iv} update={update} error={errors[q.code]} />
          ))}
          {/* B1: Extra contact fields appended to Section A */}
          {step.section.code === "A" && (
            <>
              <div className="question">
                <div className="label">Respondent Email</div>
                <input
                  type="text"
                  value={iv.respondent_email || ""}
                  onChange={e => setIv(prev => ({ ...prev, respondent_email: e.target.value, updatedAt: new Date().toISOString() }))}
                  placeholder="email@example.com"
                />
              </div>
              <div className="question">
                <div className="label">Respondent Phone</div>
                <input
                  type="text"
                  value={iv.respondent_phone || ""}
                  onChange={e => setIv(prev => ({ ...prev, respondent_phone: e.target.value, updatedAt: new Date().toISOString() }))}
                  placeholder="+260 XXX XXX XXX"
                />
              </div>
            </>
          )}
          {step.section.code === "B" && hasStraightLineTier1(iv) && (
            <div className="warn">QC notice: Several scores are all 5 — please probe the respondent to confirm.</div>
          )}
        </div>
      )}

      {step.kind === "t2" && (
        <Tier2Grid iv={iv} questionnaire={questionnaire} updateT2={updateT2} errorMsg={errors._t2} />
      )}

      {step.kind === "barriers" && (
        <BarrierAnalysis
          iv={iv}
          questionnaire={questionnaire}
          update={update}
          setIv={setIv}
          errors={errors}
        />
      )}

      {/* C2: Additional Contacts step */}
      {step.kind === "contacts" && (
        <AdditionalContactsScreen iv={iv} setIv={setIv} />
      )}

      {step.kind === "review" && <ReviewScreen iv={iv} questionnaire={questionnaire} />}

      {submitWarn && <div className="error" style={{ marginTop: 12 }}>{submitWarn}</div>}

      <footer className="bottom-bar">
        {stepIdx === 0 ? (
          <button className="ghost" onClick={onBack}>← Stakeholders</button>
        ) : (
          <button className="secondary" onClick={prev}>← Back</button>
        )}
        {stepIdx < steps.length - 1 ? (
          <button className="primary" onClick={next}>Next →</button>
        ) : (
          <button className="success" onClick={submit}>Submit interview</button>
        )}
      </footer>
    </div>
  );
}

// ----------------- Tier 2 Grid -----------------
function Tier2Grid({
  iv,
  questionnaire,
  updateT2,
  errorMsg,
}: {
  iv: Interview;
  questionnaire: Questionnaire;
  updateT2: (index: number, patch: Partial<T2Item>) => void;
  errorMsg?: string;
}) {
  return (
    <div>
      <div className="section-title">
        <span className="section-code">F</span>
        Implementation Review (Tier 2)
      </div>
      <p className="muted small">
        For each item assigned to this institution, mark the implementation status and — if relevant —
        rate the quality/success. Add a one-line rationale.
      </p>

      {iv.t2_items.length === 0 && (
        <div className="card muted">No Tier 2 items are defined for this stakeholder in the source matrix.</div>
      )}

      {iv.t2_items.map((it) => (
        <div className="t2-item" key={it.index}>
          <div className="t2-title">
            <span className="t2-num">Item {it.index}</span>
            {it.text}
          </div>

          <div className="sublabel">Implementation status</div>
          <div className="options">
            {questionnaire.t2_status_options.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`option-btn${it.status === o.value ? " selected" : ""}`}
                onClick={() => updateT2(it.index, {
                  status: o.value,
                  rating: o.value === 4 ? null : it.rating,
                })}
              >
                <span className="dot" />
                {o.label}
              </button>
            ))}
          </div>

          {it.status !== null && it.status !== 4 && (
            <>
              <div className="sublabel">Quality / success rating</div>
              <div className="likert">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`lbtn${it.rating === n ? " selected" : ""}`}
                    onClick={() => updateT2(it.index, { rating: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="likert-labels">
                <span>Very poor</span>
                <span>Excellent</span>
              </div>
            </>
          )}

          <div className="sublabel">Brief rationale / evidence (optional)</div>
          <textarea
            value={it.rationale}
            onChange={(e) => updateT2(it.index, { rationale: e.target.value })}
            placeholder="1–2 sentences — e.g. 'Act drafted but not enacted; bill tabled in Parliament 2024.'"
          />
        </div>
      ))}

      {hasStraightLineTier2(iv) && (
        <div className="warn">
          QC notice: All Tier 2 ratings are 5. Please probe to confirm this is accurate.
        </div>
      )}
      {errorMsg && <div className="error">{errorMsg}</div>}
    </div>
  );
}

// ----------------- Barriers & recommendation -----------------
function BarrierAnalysis({
  iv,
  questionnaire,
  setIv,
  errors,
}: {
  iv: Interview;
  questionnaire: Questionnaire;
  update: (c: string, v: AnswerValue) => void;
  setIv: (cb: (i: Interview) => Interview) => void;
  errors: Record<string, string>;
}) {
  const showBarriers = shouldShowBarriers(iv);

  const toggleBar = (n: number) => {
    setIv((prev) => {
      const has = prev.barriers.includes(n);
      const next = has ? prev.barriers.filter((x) => x !== n) : [...prev.barriers, n].sort((a, b) => a - b);
      return { ...prev, barriers: next, updatedAt: new Date().toISOString() };
    });
  };

  return (
    <div>
      <div className="section-title">
        <span className="section-code">G</span>
        Barrier analysis &amp; recommendation
      </div>

      {showBarriers ? (
        <>
          <div className="question">
            <div className="label">
              <span className="section-code">T2_BAR</span>
              Looking at items rated Partially or Not implemented — what were the main reasons? Select all that apply.
              <span className="req">*</span>
            </div>
            <div className="options">
              {questionnaire.t2_barrier_options.map((label, i) => {
                const n = i + 1;
                return (
                  <button
                    key={n}
                    type="button"
                    className={`option-btn multi${iv.barriers.includes(n) ? " selected" : ""}`}
                    onClick={() => toggleBar(n)}
                  >
                    <span className="dot" />
                    {label}
                  </button>
                );
              })}
            </div>
            {errors._bar && <div className="error">{errors._bar}</div>}
          </div>

          {iv.barriers.includes(12) && (
            <div className="question">
              <div className="label">
                <span className="section-code">T2_BAR_OTH</span>
                Please specify the "Other" barrier. <span className="req">*</span>
              </div>
              <textarea
                value={iv.barrier_other}
                onChange={(e) => setIv((p) => ({ ...p, barrier_other: e.target.value, updatedAt: new Date().toISOString() }))}
                placeholder="Describe the other barrier"
              />
              {errors._bar_oth && <div className="error">{errors._bar_oth}</div>}
            </div>
          )}
        </>
      ) : (
        <div className="card muted">
          All Tier 2 items were rated as Fully implemented — barrier analysis is skipped per the questionnaire logic.
        </div>
      )}

      <div className="question">
        <div className="label">
          <span className="section-code">T2_OPEN</span>
          In 2–3 sentences: the single most important change you would recommend for the 2026–2036 NTLP.
        </div>
        <textarea
          value={iv.recommendation}
          onChange={(e) => setIv((p) => ({ ...p, recommendation: e.target.value, updatedAt: new Date().toISOString() }))}
          placeholder="Your recommended change…"
          maxLength={500}
        />
       <div className="notes">Max 500 characters.</div>
      </div>

      <div className="question">
        <div className="label">
          <span className="section-code">T2_ENUM</span>
          Enumerator's impressions and comments (your own notes — not read to the respondent).
        </div>
        <textarea
          value={iv.enumerator_comments || ""}
          onChange={(e) => setIv((p) => ({ ...p, enumerator_comments: e.target.value, updatedAt: new Date().toISOString() }))}
          placeholder="Your impressions, context, anything notable about this interview…"
        />
      </div>
    </div>
  );
}
// ----------------- Review -----------------
function ReviewScreen({ iv, questionnaire }: { iv: Interview; questionnaire: Questionnaire }) {
  const allT1 = questionnaire.sections.flatMap((s) => s.questions);
  const missingT1 = tier1Missing(allT1, iv);
  const missingT2 = tier2Missing(iv);
  const total = missingT1.length + missingT2.length;

  const findLabel = (code: string, value: unknown): string => {
    const q = allT1.find((x) => x.code === code);
    if (!q) return String(value ?? "");
    if (!q.options.length) return String(value ?? "");
    if (Array.isArray(value)) return (value as number[]).map((v) => q.options.find((o) => o.value === v)?.label ?? v).join(", ");
    return q.options.find((o) => o.value === value)?.label ?? String(value ?? "");
  };

  return (
    <div>
      <div className="section-title">Review &amp; submit</div>
      {total === 0 ? (
        <div className="card" style={{ background: "var(--green-light)", borderColor: "var(--green)" }}>
          <div className="bold">All required fields are complete.</div>
          <div className="small muted">Tap "Submit interview" below when ready.</div>
        </div>
      ) : (
        <div className="card" style={{ background: "var(--red-light)", borderColor: "var(--red)" }}>
          <div className="bold">{total} required field(s) missing</div>
          <div className="small">
            {[...missingT1, ...missingT2].slice(0, 10).join(", ")}
            {total > 10 ? "…" : ""}
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>Use "Back" to fix, then return here.</div>
        </div>
      )}

      {questionnaire.sections.filter((s) => s.code !== "G").map((s) => (
        <div key={s.code} className="card">
          <div className="bold" style={{ marginBottom: 6 }}>
            <span className="section-code">{s.code}</span>
            {s.title}
          </div>
          {s.questions.filter((q) => shouldShow(q.code, iv)).map((q) => (
            <div className="review-row" key={q.code}>
              <div className="q">{q.code} · {q.text.slice(0, 60)}{q.text.length > 60 ? "…" : ""}</div>
              <div className="a">{findLabel(q.code, iv.answers[q.code]) || <span className="muted">—</span>}</div>
            </div>
          ))}
        </div>
      ))}

      <div className="card">
        <div className="bold" style={{ marginBottom: 6 }}>
          <span className="section-code">F</span>
          Tier 2 — {iv.t2_items.length} item(s)
        </div>
        {iv.t2_items.map((it) => (
          <div className="review-row" key={it.index}>
            <div className="q">Item {it.index} · {it.text.slice(0, 55)}{it.text.length > 55 ? "…" : ""}</div>
            <div className="a">
              {it.status ? `S${it.status}` : "—"}
              {it.rating ? ` / R${it.rating}` : ""}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="bold" style={{ marginBottom: 6 }}>
          <span className="section-code">G</span>Barriers &amp; recommendation
        </div>
        <div className="review-row">
          <div className="q">Barriers</div>
          <div className="a">{iv.barriers.length ? iv.barriers.map((n) => questionnaire.t2_barrier_options[n - 1]).join("; ") : "—"}</div>
        </div>
        {iv.barrier_other && (
          <div className="review-row">
            <div className="q">Other barrier</div>
            <div className="a">{iv.barrier_other}</div>
          </div>
        )}
        <div className="review-row">
          <div className="q">Recommendation</div>
          <div className="a">{iv.recommendation || <span className="muted">—</span>}</div>
        </div>
      </div>
    </div>
  );
}

// ----------------- Additional Contacts (C2) -----------------
function AdditionalContactsScreen({
  iv,
  setIv,
}: {
  iv: Interview;
  setIv: (cb: (i: Interview) => Interview) => void;
}) {
  const contacts: AdditionalContact[] = iv.additional_contacts || [];

  function addContact() {
    setIv(prev => ({
      ...prev,
      additional_contacts: [...(prev.additional_contacts || []), { name: "", title: "", email: "", phone: "" }],
      updatedAt: new Date().toISOString(),
    }));
  }

  function updateContact(idx: number, field: keyof AdditionalContact, value: string) {
    setIv(prev => {
      const updated = [...(prev.additional_contacts || [])];
      updated[idx] = { ...updated[idx], [field]: value };
      return { ...prev, additional_contacts: updated, updatedAt: new Date().toISOString() };
    });
  }

  function removeContact(idx: number) {
    setIv(prev => {
      const updated = [...(prev.additional_contacts || [])];
      updated.splice(idx, 1);
      return { ...prev, additional_contacts: updated, updatedAt: new Date().toISOString() };
    });
  }

  return (
    <div>
      <div className="section-title">
        <span className="section-code">H</span>
        Additional Contacts
      </div>
      <p className="small muted" style={{ marginBottom: 16 }}>
        Please provide contact details of other people in this institution who can help collect
        information about current, ongoing, and planned projects, services, and activities
        related to transport policy.
      </p>

      {contacts.map((contact, idx) => (
        <div className="card" key={idx} style={{ marginBottom: 12, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span className="bold small">Contact {idx + 1}</span>
            <button
              type="button"
              className="btn-danger"
              style={{ padding: "4px 10px", fontSize: "0.78rem" }}
              onClick={() => removeContact(idx)}
            >Remove</button>
          </div>
          {(["name", "title", "email", "phone"] as (keyof AdditionalContact)[]).map(field => (
            <div className="question" key={field} style={{ marginBottom: 10 }}>
              <div className="label" style={{ textTransform: "capitalize" }}>{field}</div>
              <input
                type="text"
                value={contact[field] || ""}
                onChange={e => updateContact(idx, field, e.target.value)}
                placeholder={field === "email" ? "email@example.com" : field === "phone" ? "+260 XXX XXX XXX" : ""}
              />
            </div>
          ))}
        </div>
      ))}

      <button
        type="button"
        onClick={addContact}
        style={{
          width: "100%", padding: "12px",
          background: "white", border: "2px dashed var(--primary, #1a3a6c)",
          borderRadius: 10, color: "var(--primary, #1a3a6c)",
          fontWeight: 700, fontSize: "0.92rem", cursor: "pointer",
        }}
      >+ Add Contact Person</button>
    </div>
  );
}
