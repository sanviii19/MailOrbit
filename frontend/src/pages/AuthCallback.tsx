import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const AuthCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      login(token).then(() => {
        // Clear the token from URL and navigate to dashboard
        navigate('/', { replace: true });
      });
    } else {
      // Handle error or redirect
      navigate('/login?error=auth_failed', { replace: true });
    }
  }, [searchParams, navigate, login]);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center space-y-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-green-500 border-t-transparent"></div>
        <p className="text-gray-500 font-medium">Authenticating...</p>
      </div>
    </div>
  );
};

export default AuthCallback;
