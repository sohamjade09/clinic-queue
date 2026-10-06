import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from './supabase'

const pad = (n) => String(n).padStart(3, '0')

export default function Lobby() {
  const { clinicId } = useParams()
  const [clinic, setClinic] = useState(null)
  const [doctors, setDoctors] = useState([])
  const [tokens, setTokens] = useState([])
  const [clock, setClock] = useState(new Date())
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const [c, d, t] = await Promise.all([
      supabase.from('clinics').select('id, name').eq('id', clinicId).maybeSingle(),
      supabase.from('doctors').select('*').eq('clinic_id', clinicId).order('created_at'),
      supabase
        .from('tokens')
        .select('id, doctor_id, token_number, status, is_priority, created_at')
        .eq('clinic_id', clinicId)
        .in('status', ['waiting', 'called', 'in_consultation'])
        .gte('created_at', start.toISOString()),
    ])
    setClinic(c.data)
    setDoctors(d.data || [])
    setTokens(t.data || [])
    setLoading(false)
  }, [clinicId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const poll = setInterval(load, 10000)
    const tick = setInterval(() => setClock(new Date()), 30000)
    return () => {
      clearInterval(poll)
      clearInterval(tick)
    }
  }, [load])

  useEffect(() => {
    const channel = supabase
      .channel('lobby-' + clinicId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tokens', filter: 'clinic_id=eq.' + clinicId }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'doctors', filter: 'clinic_id=eq.' + clinicId }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [clinicId, load])

  if (loading) return <div className="tv"><div className="tv-center">Loading...</div></div>
  if (!clinic) return <div className="tv"><div className="tv-center">Clinic not found.</div></div>

  return (
    <div className="tv">
      <div className="tv-head">
        <h1>{clinic.name}</h1>
        <div className="tv-clock">
          {clock.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      <div className={'tv-grid cols-' + Math.min(doctors.length, 3)}>
        {doctors.map((d) => {
          const mine = tokens.filter((t) => t.doctor_id === d.id)
          const current = mine
            .filter((t) => t.status === 'called' || t.status === 'in_consultation')
            .sort((a, b) => a.token_number - b.token_number)[0]
          const next = mine
            .filter((t) => t.status === 'waiting')
            .sort((a, b) => Number(b.is_priority) - Number(a.is_priority) || new Date(a.created_at) - new Date(b.created_at))
            .slice(0, 5)

          return (
            <div className="tv-card" key={d.id}>
              <div className="tv-doc">{d.name}</div>
              <div className="tv-spec">{d.specialty || 'General'}</div>

              {d.status !== 'available' && (
                <div className="tv-status">{d.status === 'paused' ? 'On a short break' : 'Closed'}</div>
              )}

              <div className="tv-label">NOW SERVING</div>
              <div className={'tv-now' + (current?.status === 'called' ? ' blink' : '')}>
                {current ? '#' + pad(current.token_number) : '—'}
              </div>

              <div className="tv-label">NEXT</div>
              <div className="tv-next">
                {next.length === 0 && <span className="tv-none">No one waiting</span>}
                {next.map((t) => (
                  <span className="tv-chip" key={t.id}>#{pad(t.token_number)}</span>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {doctors.length === 0 && <div className="tv-center">No doctors added yet.</div>}
    </div>
  )
}