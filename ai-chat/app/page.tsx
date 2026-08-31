'use client';

import dynamic from 'next/dynamic';

const IndependentClient = dynamic(() => import('./independent'), {
  ssr: false,
});

export default function Home() {
  return <IndependentClient />;
}
