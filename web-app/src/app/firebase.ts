import { initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: 'AIzaSyBmR-1UPD5h772Wp1OpM4UVPWVU_3Oi-fo',
  authDomain: 'web-claw.firebaseapp.com',
  projectId: 'web-claw',
  storageBucket: 'web-claw.firebasestorage.app',
  messagingSenderId: '464878762697',
  appId: '1:464878762697:web:754ee24b00f615702ceb18',
  measurementId: 'G-TJBJ1ES40M',
};

export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
