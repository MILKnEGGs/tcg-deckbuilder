import { mount } from 'svelte';
import App from '@milk/core/App.svelte';
import '@milk/core/style.css';
import './theme.css';
import { game } from './game';

export default mount(App, { target: document.getElementById('app')!, props: { game } });
