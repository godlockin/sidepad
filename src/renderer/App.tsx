import React from 'react';
import { Heartbeat } from './components/Heartbeat';

export function App() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-semibold mb-2">sidepad</h1>
      <p className="mb-4">Phase 1 skeleton.</p>
      <Heartbeat />
    </div>
  );
}
