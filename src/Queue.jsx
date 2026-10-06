import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

const pad = (n) => String(n).padStart(3, '0')

export default function Queue({ clinic, doctors, onDoctorsChange }) {
  const [doctorId, setDoctorId] = useState(doctors[0]?.id || '')
  const [tokens, setTokens] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [walkin, setWalkin] = useState({ name: '', phone: '' })

  useEffect(() => {
    if (!doctors.find((d) => d.id === doctorId)) setDoctorId(doctors[0]?.id || '')
  }, [doctors, doctorId])

  const doctor = doctors.find((d) => d.id === doctorId)

  const load = useCallback(async () => {
    if (!doctorId) return
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const { data, error } = await supabase
      .from('tokens')
      .select('*')
      .eq('doctor_id', doctorId)
      .gte('created_at', start.toISOString())
      .order('created_at')
    if (error) setError(error.message)
    else setTokens(data)
  }, [doctorId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const timer = setInterval(load, 10000)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!doctorId) return
    const channel = supabase
      .channel('reception-' + doctorId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tokens', filter: 'doctor_id=eq.' + doctorId }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [doctorId, load])

  const current = tokens.find((t) => t.status === 'called' || t.status === 'in_consultation')
  const waiting = tokens
    .filter((t) => t.status === 'waiting')
    .sort((a, b) => Number(b.is_priority) - Number(a.is_priority) || new Date(a.created_at) - new Date(b.created_at))
  const skipped = tokens.filter((t) => t.status === 'skipped')
  const doneCount = tokens.filter((t) => t.status === 'completed').length

  async function updateToken(id, fields) {
    setBusy(true)
    setError('')
    const { error } = await supabase.from('tokens').update(fields).eq('id', id)
    if (error) setError(error.message)
    await load()
    setBusy(false)
  }

  function callNext() {
    if (!waiting[0]) return
    updateToken(waiting[0].id, { status: 'called', called_at: new Date().toISOString() })
  }

  function startConsult(t) {
    updateToken(t.id, { status: 'in_consultation', started_at: new Date().toISOString() })
  }

  function skip(t) {
    updateToken(t.id, { status: 'skipped' })
  }

  function togglePriority(t) {
    updateToken(t.id, { is_priority: !t.is_priority })
  }

  function requeue(t) {
    updateToken(t.id, { status: 'waiting', created_at: new Date().toISOString(), called_at: null })
  }

  async function finish(t) {
    setBusy(true)
    setError('')
    const now = new Date()
    const { error } = await supabase
      .from('tokens')
      .update({ status: 'completed', completed_at: now.toISOString() })
      .eq('id', t.id)
    if (error) {
      setError(error.message)
      setBusy(false)
      return
    }

    // Log consult time and update the doctor's rolling average (last 10)
    const from = t.started_at || t.called_at
    if (from) {
      const mins = (now - new Date(from)) / 60000
      if (mins >= 0.5) {
        await supabase.from('queue_logs').insert({ doctor_id: t.doctor_id, duration_minutes: Number(mins.toFixed(2)) })
        const { data: logs } = await supabase
          .from('queue_logs')
          .select('duration_minutes')
          .eq('doctor_id', t.doctor_id)
          .order('created_at', { ascending: false })
          .limit(10)
        if (logs && logs.length) {
          const avg = logs.reduce((s, l) => s + Number(l.duration_minutes), 0) / logs.length
          await supabase.from('doctors').update({ avg_consult_minutes: Math.max(1, Math.round(avg)) }).eq('id', t.doctor_id)
          onDoctorsChange()
        }
      }
    }
    await load()
    setBusy(false)
  }

  async function addWalkin(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.from('tokens').insert({
      clinic_id: clinic.id,
      doctor_id: doctorId,
      patient_name: walkin.name,
      patient_phone: walkin.phone || null,
      source: 'walkin',
    })
    if (error) setError(error.message)
    else setWalkin({ name: '', phone: '' })
    await load()
    setBusy(false)
  }

  async function togglePause() {
    const next = doctor.status === 'paused' ? 'available' : 'paused'
    const { error } = await supabase.from('doctors').update({ status: next }).eq('id', doctor.id)
    if (error) setError(error.message)
    else onDoctorsChange()
  }

  if (doctors.length === 0) {
    return (
      <div className="card section">
        <p className="muted">Add a doctor in the Setup tab to start managing the queue.</p>
      </div>
    )
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}

      <div className="card section">
        <div className="qhead">
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          {doctor && (
            <button className={doctor.status === 'paused' ? '' : 'ghost'} onClick={togglePause}>
              {doctor.status === 'paused' ? 'Resume' : 'Pause'}
            </button>
          )}
        </div>
        <div className="qstats">
          <span>Waiting: <strong>{waiting.length}</strong></span>
          <span>Seen today: <strong>{doneCount}</strong></span>
          <span>Avg: <strong>{doctor?.avg_consult_minutes} min</strong></span>
        </div>
        {doctor?.status === 'paused' && <div className="banner-warn">Doctor is paused. Patients can see this on their page.</div>}
        {doctor?.status === 'closed' && <div className="banner-warn">Doctor is marked closed. Patients cannot join.</div>}
      </div>

      <div className="card section now-card">
        <h2>Now</h2>
        {current ? (
          <>
            <div className="now-token">#{pad(current.token_number)}</div>
            <p className="muted">
              {current.patient_name} · {current.status === 'called' ? 'Called, waiting to enter' : 'In consultation'}
            </p>
            <div className="row">
              {current.status === 'called' ? (
                <button disabled={busy} onClick={() => startConsult(current)}>Start</button>
              ) : (
                <button disabled={busy} onClick={() => finish(current)}>Done</button>
              )}
              {current.status === 'called' ? (
                <button className="danger" disabled={busy} onClick={() => skip(current)}>No-show / Skip</button>
              ) : (
                <button className="ghost" disabled={busy} onClick={() => finish(current)}>Finish</button>
              )}
            </div>
          </>
        ) : (
          <p className="muted">No one is being served.</p>
        )}
        <button
          className="full next-btn"
          disabled={busy || !!current || waiting.length === 0}
          onClick={callNext}
        >
          {waiting.length === 0
            ? 'Queue is empty'
            : current
            ? 'Finish current patient first'
            : 'Call next: #' + pad(waiting[0].token_number)}
        </button>
      </div>

      <div className="card section">
        <h2>Waiting ({waiting.length})</h2>
        {waiting.length === 0 && <p className="muted">Nobody waiting.</p>}
        {waiting.map((t, i) => (
          <div className="doctor" key={t.id}>
            <div>
              <strong>#{pad(t.token_number)}</strong> {t.patient_name}
              {t.is_priority && <span className="tag">Priority</span>}
              {t.source === 'walkin' && <span className="tag gray">Walk-in</span>}
              <div className="muted" style={{ margin: 0 }}>
                {i + 1}{i === 0 ? 'st' : i === 1 ? 'nd' : i === 2 ? 'rd' : 'th'} in line{t.patient_phone ? ' · ' + t.patient_phone : ''}
              </div>
            </div>
            <div className="actions">
              <button className="ghost" disabled={busy} onClick={() => togglePriority(t)}>
                {t.is_priority ? 'Remove priority' : 'Priority'}
              </button>
              <button className="danger" disabled={busy} onClick={() => updateToken(t.id, { status: 'cancelled' })}>Remove</button>
            </div>
          </div>
        ))}
      </div>

      <form className="card section" onSubmit={addWalkin}>
        <h2>Add walk-in patient</h2>
        <div className="row">
          <input placeholder="Patient name" value={walkin.name} onChange={(e) => setWalkin({ ...walkin, name: e.target.value })} required />
          <input
            type="tel"
            placeholder="Phone (optional)"
            value={walkin.phone}
            onChange={(e) => setWalkin({ ...walkin, phone: e.target.value.replace(/\D/g, '') })}
          />
        </div>
        <button className="full" disabled={busy || !doctorId}>Add to queue</button>
      </form>

      {skipped.length > 0 && (
        <div className="card section">
          <h2>Skipped ({skipped.length})</h2>
          {skipped.map((t) => (
            <div className="doctor" key={t.id}>
              <div>
                <strong>#{pad(t.token_number)}</strong> {t.patient_name}
              </div>
              <button className="ghost" disabled={busy} onClick={() => requeue(t)}>Put back in queue</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}