import { render } from 'preact';
import { App } from './app';
import 'katex/dist/katex.min.css';
import './index.css';

const rootEl = document.getElementById('app');
if (rootEl) {
  render(<App />, rootEl);
}
