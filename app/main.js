import { ENV } from 'varlock/env';

export const greeting = ENV.GREETING;
document.querySelector('#greeting').textContent = greeting;
