import { render } from 'preact';
import { App } from './app';
import './index.css';

const rootEl = document.getElementById('app');
if (rootEl) {
  render(<App />, rootEl);
}