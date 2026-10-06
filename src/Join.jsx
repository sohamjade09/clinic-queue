import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from './supabase'

export default function Join() {
  const { clinicId } = useParams()
  const navigate = useNavigate()
  const [clinic, setClinic] = useState(null)
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ doctor_id: '', name: '', phone: '' })
  const lastTokenId = localStorage.getItem('lastTokenId')

  useEffect(() => {
    async function load() {
      const { data: c } = await supabase
        .from('clinics')
        .select('id, name, address')
        .eq('id', clinicId)
        .maybeSingle()
      setClinic(c)
      if (c) {
        const { data: d } = await supabase
          .from('doctors')
          .select('*')
          .eq('clinic_id', clinicId)
          .neq('status', 'closed')
          .order('created_at')
        setDoctors(d || [])
        if (d && d.length === 1) setForm((f) => ({ ...f, doctor_id: d[0].id }))
      }
      setLoading(false)
    }
    load()
  }, [clinicId])

  async function join(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    const start = new Date()
    start.setHours(0, 0, 0, 0)

    // If this phone already has an active token with this doctor today, reuse it
    const { data: existing } = await supabase
      .from('tokens')
      .select('id')
      .eq('doctor_id', form.doctor_id)
      .eq('patient_phone', form.phone)
      .in('status', ['waiting', 'called', 'in_consultation'])
      .gte('created_at', start.toISOString())
      .limit(1)
      .maybeSingle()

    if (existing) {
      localStorage.setItem('lastTokenId', existing.id)
      navigate('/t/' + existing.id)
      return
    }

    const { data, error } = await supabase
      .from('tokens')
      .insert({
        clinic_id: clinicId,
        doctor_id: form.doctor_id,
        patient_name: form.name,
        patient_phone: form.phone,
        source: 'qr',
      })
      .select()
      .single()

    if (error) {
      setError(error.message)
      setSubmitting(false)
      return
    }
    localStorage.setItem('lastTokenId', data.id)
    navigate('/t/' + data.id)
  }

  if (loading) return <div className="center">Loading...</div>
  if (!clinic) return <div className="center">Clinic not found.</div>

  return (
    <div className="center">
      <form className="card" onSubmit={join}>
        <h1>{clinic.name}</h1>
        <p className="muted">{clinic.address || 'Join the queue'}</p>

        {lastTokenId && (
          <div className="info">
            <Link to={'/t/' + lastTokenId}>View my current token</Link>
          </div>
        )}

        {error && <div className="error">{error}</div>}

        {doctors.length === 0 ? (
          <p className="muted">No doctors are available right now.</p>
        ) : (
          <>
            <select value={form.doctor_id} onChange={(e) => setForm({ ...form, doctor_id: e.target.value })} required>
              <option value="">Select doctor</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} {d.specialty ? '(' + d.specialty + ')' : ''} {d.status === 'paused' ? ' - on break' : ''}
                </option>
              ))}
            </select>
            <input placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input
              type="tel"
              placeholder="Phone number (10 digits)"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })}
              pattern="[0-9]{10}"
              title="Enter a 10 digit phone number"
              required
            />
            <button className="full" disabled={submitting}>
              {submitting ? 'Getting your token...' : 'Get my token'}
            </button>
          </>
        )}
      </form>
    </div>
  )
}