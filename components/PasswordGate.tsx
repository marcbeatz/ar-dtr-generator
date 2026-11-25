'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { unlockSite } from '@/lib/auth';

export function PasswordGate({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const ok = await unlockSite(password);
    if (ok) {
      router.push(nextPath);
      return;
    }
    setPending(false);
    setError('Mali ka ng pinasukang liga!');
  }

  return (
    <main className='lock'>
      <form onSubmit={onSubmit}>
        <p className='brand'>Chunin Exam</p>
        <h1>Hokage lang ang makakapasok dito.</h1>
        <label className='field'>
          <span>Ilagay ang secret code</span>
          <input
            type='password'
            name='password'
            value={password}
            autoFocus
            autoComplete='current-password'
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p className='error'>{error}</p> : null}
        <button className='primary' type='submit' disabled={pending}>
          Continue
        </button>
      </form>
    </main>
  );
}
