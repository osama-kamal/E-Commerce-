import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from './useAppDispatch';
import { addNotification } from '../store/notificationSlice';

export function useNotifications() {
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Welcome notification on login
    const hasShownWelcome = sessionStorage.getItem('welcomeShown');
    if (!hasShownWelcome) {
      dispatch(addNotification({
        type: 'success',
        title: 'Welcome back!',
        message: 'Check out our latest deals and offers',
        actionUrl: '/',
      }));
      sessionStorage.setItem('welcomeShown', 'true');
    }

    // Simulate periodic notifications (in real app, these would come from backend/websocket)
    const interval = setInterval(() => {
      const random = Math.random();
      
      if (random < 0.3) {
        dispatch(addNotification({
          type: 'info',
          title: 'New Products Available',
          message: 'Check out our latest arrivals in Electronics',
          actionUrl: '/',
        }));
      } else if (random < 0.5) {
        dispatch(addNotification({
          type: 'warning',
          title: 'Limited Stock Alert',
          message: 'Some items in your wishlist are running low on stock',
          actionUrl: '/wishlist',
        }));
      }
    }, 60000); // Every minute (for demo purposes)

    return () => clearInterval(interval);
  }, [isAuthenticated, dispatch]);
}
