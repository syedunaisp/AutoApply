'use client'

import { useEffect, useState } from 'react'
import { getProfile, updateProfile } from '@/lib/api-client'

// For now, hardcode a default user ID — in production this comes from auth
const DEFAULT_USER_ID = 'user_001'

interface ProfileFormData {
  phone: string
  location: string
  linkedinUrl: string
  githubUrl: string
  portfolioUrl: string
  personalEmail: string
  currentTitle: string
  yearsExperience: number
  summary: string
  skills: string[]
  experience: Array<{
    company: string
    title: string
    startDate: string
    endDate: string
    bullets: string[]
  }>
  education: Array<{
    institution: string
    degree: string
    field: string
  }>
  achievements: string[]
  targetRoles: string[]
  targetLocations: string[]
  remoteOnly: boolean
  minSalary: number
  visaRequired: boolean
}

const emptyProfile: ProfileFormData = {
  phone: '', location: '', linkedinUrl: '', githubUrl: '', portfolioUrl: '',
  personalEmail: '', currentTitle: '', yearsExperience: 0, summary: '',
  skills: [], experience: [], education: [], achievements: [],
  targetRoles: [], targetLocations: [],
  remoteOnly: false, minSalary: 0, visaRequired: false,
}

export default function SettingsPage() {
  const [form, setForm] = useState<ProfileFormData>(emptyProfile)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [skillInput, setSkillInput] = useState('')
  const [roleInput, setRoleInput] = useState('')
  const [locationInput, setLocationInput] = useState('')
  const [achievementInput, setAchievementInput] = useState('')

  useEffect(() => {
    loadProfile()
  }, [])

  async function loadProfile() {
    try {
      setLoading(true)
      const data = await getProfile(DEFAULT_USER_ID)
      if (data.profile) {
        setForm({
          phone: data.profile.phone || '',
          location: data.profile.location || '',
          linkedinUrl: data.profile.linkedin_url || '',
          githubUrl: data.profile.github_url || '',
          portfolioUrl: data.profile.portfolio_url || '',
          personalEmail: data.profile.personal_email || '',
          currentTitle: data.profile.current_title || '',
          yearsExperience: data.profile.years_experience || 0,
          summary: data.profile.summary || '',
          skills: safeJsonParse(data.profile.skills, []),
          experience: safeJsonParse(data.profile.experience, []),
          education: safeJsonParse(data.profile.education, []),
          achievements: safeJsonParse(data.profile.achievements, []),
          targetRoles: safeJsonParse(data.profile.target_roles, []),
          targetLocations: safeJsonParse(data.profile.target_locations, []),
          remoteOnly: !!data.profile.remote_only,
          minSalary: data.profile.min_salary || 0,
          visaRequired: !!data.profile.visa_required,
        })
      }
    } catch (err) {
      console.error('Failed to load profile:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    try {
      setSaving(true)
      await updateProfile({ ...form, userId: DEFAULT_USER_ID })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      console.error('Failed to save:', err)
    } finally {
      setSaving(false)
    }
  }

  function addToList(key: keyof ProfileFormData, value: string, clearFn: (v: string) => void) {
    if (!value.trim()) return
    const current = form[key] as string[]
    if (!current.includes(value.trim())) {
      setForm({ ...form, [key]: [...current, value.trim()] })
    }
    clearFn('')
  }

  function removeFromList(key: keyof ProfileFormData, index: number) {
    const current = form[key] as string[]
    setForm({ ...form, [key]: current.filter((_, i) => i !== index) })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="animate-pulse text-surface-700">Loading profile...</div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="gradient-text">Settings</span>
          </h1>
          <p className="text-surface-700 mt-1">Your profile and job search preferences.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
            saved
              ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-brand-600 text-white hover:bg-brand-700 shadow-lg shadow-brand-600/25'
          }`}
        >
          {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Changes'}
        </button>
      </div>

      <div className="space-y-6">
        {/* Personal Info */}
        <Section title="Personal Information">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Personal Email (Reply-To)" value={form.personalEmail}
              onChange={(v) => setForm({ ...form, personalEmail: v })} required />
            <Input label="Phone" value={form.phone}
              onChange={(v) => setForm({ ...form, phone: v })} />
            <Input label="Location" value={form.location}
              onChange={(v) => setForm({ ...form, location: v })} />
            <Input label="LinkedIn URL" value={form.linkedinUrl}
              onChange={(v) => setForm({ ...form, linkedinUrl: v })} />
            <Input label="GitHub URL" value={form.githubUrl}
              onChange={(v) => setForm({ ...form, githubUrl: v })} />
            <Input label="Portfolio URL" value={form.portfolioUrl}
              onChange={(v) => setForm({ ...form, portfolioUrl: v })} />
          </div>
        </Section>

        {/* Professional */}
        <Section title="Professional">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Current Title" value={form.currentTitle}
              onChange={(v) => setForm({ ...form, currentTitle: v })} />
            <Input label="Years of Experience" type="number" value={String(form.yearsExperience)}
              onChange={(v) => setForm({ ...form, yearsExperience: Number(v) })} />
          </div>
          <div className="mt-4">
            <label className="block text-xs text-surface-700 mb-1.5">Professional Summary</label>
            <textarea
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              rows={3}
              className="w-full bg-[#0a0b0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-surface-50 placeholder-surface-800 focus:outline-none focus:border-brand-500 resize-none"
              placeholder="2-3 sentence professional summary..."
            />
          </div>
        </Section>

        {/* Skills */}
        <Section title="Skills">
          <TagInput
            tags={form.skills}
            inputValue={skillInput}
            onInputChange={setSkillInput}
            onAdd={() => addToList('skills', skillInput, setSkillInput)}
            onRemove={(i) => removeFromList('skills', i)}
            placeholder="Add a skill and press Enter..."
          />
        </Section>

        {/* Achievements */}
        <Section title="Achievements (Specific Metrics)">
          <TagInput
            tags={form.achievements}
            inputValue={achievementInput}
            onInputChange={setAchievementInput}
            onAdd={() => addToList('achievements', achievementInput, setAchievementInput)}
            onRemove={(i) => removeFromList('achievements', i)}
            placeholder='e.g. "Reduced latency by 40% across multi-region deployment"'
          />
        </Section>

        {/* Preferences */}
        <Section title="Job Search Preferences">
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-surface-700 mb-1.5">Target Roles</label>
              <TagInput
                tags={form.targetRoles}
                inputValue={roleInput}
                onInputChange={setRoleInput}
                onAdd={() => addToList('targetRoles', roleInput, setRoleInput)}
                onRemove={(i) => removeFromList('targetRoles', i)}
                placeholder='e.g. "Senior Software Engineer"'
              />
            </div>
            <div>
              <label className="block text-xs text-surface-700 mb-1.5">Target Locations</label>
              <TagInput
                tags={form.targetLocations}
                inputValue={locationInput}
                onInputChange={setLocationInput}
                onAdd={() => addToList('targetLocations', locationInput, setLocationInput)}
                onRemove={(i) => removeFromList('targetLocations', i)}
                placeholder='e.g. "San Francisco" or "Remote"'
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Input label="Minimum Salary" type="number" value={String(form.minSalary)}
                onChange={(v) => setForm({ ...form, minSalary: Number(v) })} />
              <Toggle label="Remote Only" value={form.remoteOnly}
                onChange={(v) => setForm({ ...form, remoteOnly: v })} />
              <Toggle label="Visa Required" value={form.visaRequired}
                onChange={(v) => setForm({ ...form, visaRequired: v })} />
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}

// ─── Subcomponents ───────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-card p-6">
      <h3 className="text-sm font-semibold text-surface-50 mb-4">{title}</h3>
      {children}
    </div>
  )
}

function Input({
  label, value, onChange, type = 'text', required, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs text-surface-700 mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[#0a0b0f] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-surface-50 placeholder-surface-800 focus:outline-none focus:border-brand-500 transition-colors"
      />
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-surface-700">{label}</label>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          value ? 'bg-brand-600' : 'bg-surface-800'
        }`}
      >
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          value ? 'translate-x-5' : 'translate-x-0.5'
        }`} />
      </button>
    </div>
  )
}

function TagInput({
  tags, inputValue, onInputChange, onAdd, onRemove, placeholder,
}: {
  tags: string[]; inputValue: string; onInputChange: (v: string) => void
  onAdd: () => void; onRemove: (i: number) => void; placeholder: string
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {tags.map((tag, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-600/15 text-brand-400 rounded-lg text-xs font-medium">
            {tag}
            <button onClick={() => onRemove(i)} className="text-brand-400/60 hover:text-brand-400 text-sm">×</button>
          </span>
        ))}
      </div>
      <input
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd() } }}
        placeholder={placeholder}
        className="w-full bg-[#0a0b0f] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-surface-50 placeholder-surface-800 focus:outline-none focus:border-brand-500 transition-colors"
      />
    </div>
  )
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) } catch { return fallback }
}
