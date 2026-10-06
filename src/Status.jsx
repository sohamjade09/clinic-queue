import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from './supabase'

const ACTIVE = ['waiting', 'called', 'in_consultation']

function pad(n) {
  return String(n).padStart(3, '0')
}

export default function Status() {
  const { tokenId } = useParams()
  const [token, setToken] = useState(null)
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    const { data: t } = await supabase
      .from('tokens')
      .select('*, doctors(name, avg_consult_minutes, status), clinics(name)')
      .eq('id', tokenId)
      .maybeSingle()

    if (!t) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setToken(t)

    const start = new Date(t.created_at)
    start.setHours(0, 0, 0, 0)

    const { data: q } = await supabase
      .from('tokens')
      .select('id, token_number, status, is_priority, created_at')
      .eq('doctor_id', t.doctor_id)
      .in('status', ACTIVE)
      .gte('created_at', start.toISOString())

    setQueue(q || [])
    setLoading(false)
  }, [tokenId])

  useEffect(() => {
    load()
  }, [load])

  // Fallback refresh every 15 seconds
  useEffect(() => {
    const timer = setInterval(load, 15000)
    return () => clearInterval(timer)
  }, [load])

  // Realtime updates
  const doctorId = token?.doctor_id
  useEffect(() => {
    if (!doctorId) return
    const channel = supabase
      .channel('queue-' + doctorId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tokens', filter: 'doctor_id=eq.' + doctorId }, load)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'doctors', filter: 'id=eq.' + doctorId }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [doctorId, load])

  async function cancel() {
    if (!window.confirm('Cancel your token?')) return
    await supabase.rpc('cancel_token', { p_token_id: tokenId })
    load()
  }

  if (loading) return <div className="center">Loading...</div>
  if (notFound) return <div className="center">Token not found.</div>

  const doctor = token.doctors
  const others = queue.filter((q) => q.id !== token.id)
  const beingServed = others.filter((q) => q.status === 'called' || q.status === 'in_consultation')
  const waitingBefore = others.filter(
    (q) =>
      q.status === 'waiting' &&
      ((q.is_priority && !token.is_priority) ||
        (q.is_priority === token.is_priority && new Date(q.created_at) < new Date(token.created_at)))
  )
  const ahead = beingServed.length + waitingBefore.length

  const nowServing = queue
    .filter((q) => q.status === 'called' || q.status === 'in_consultation')
    .sort((a, b) => a.token_number - b.token_number)[0]

  const avg = doctor.avg_consult_minutes || 10
  const estimate = ahead * avg
  const low = Math.max(1, Math.round(estimate * 0.75))
  const high = Math.round(estimate * 1.25)

  const isWaiting = token.status === 'waiting'

  return (
    <div className="center">
      <div className="card" style={{ textAlign: 'center' }}>
        <p className="muted" style={{ marginBottom: 4 }}>{token.clinics.name}</p>
        <p className="muted">{doctor.name}</p>

        <div className="token-big">#{pad(token.token_number)}</div>
        <p className="muted">Hi {token.patient_name}, this is your token</p>

        {doctor.status === 'paused' && isWaiting && (
          <div className="banner-warn">The doctor is on a short break. Wait times may be longer.</div>
        )}

        {isWaiting && (
          <>
            {ahead === 0 ? (
              <div className="info">You're next! Please be at the clinic now.</div>
            ) : (
              <div className="stats">
                <div>
                  <div className="stat-num">{ahead}</div>
                  <div className="muted">people ahead</div>
                </div>
                <div>
                  <div className="stat-num">{low}-{high}</div>
                  <div className="muted">minutes (approx)</div>
                </div>
              </div>
            )}
            <p className="muted">Now serving: {nowServing ? '#' + pad(nowServing.token_number) : '—'}</p>
            <button className="danger" onClick={cancel}>Cancel my token</button>
          </>
        )}

        {token.status === 'called' && (
          <div className="info">It's your turn! Please go to {doctor.name}'s room.</div>
        )}
        {token.status === 'in_consultation' && <div className="info">Your consultation is in progress.</div>}
        {token.status === 'completed' && <div className="info">Consultation completed. Thank you!</div>}
        {token.status === 'skipped' && (
          <div className="banner-warn">You missed your turn. Please speak to the reception to rejoin.</div>
        )}
        {token.status === 'cancelled' && (
          <>
            <div className="banner-warn">This token was cancelled.</div>
            <Link to={'/c/' + token.clinic_id}>Get a new token</Link>
          </>
        )}

        <p className="muted" style={{ marginTop: 18, fontSize: 12 }}>This page updates automatically.</p>
      </div>
    </div>
  )
}