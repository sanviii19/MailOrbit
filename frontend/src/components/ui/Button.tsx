import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost';
  fullWidth?: boolean;
}

export const Button = ({ 
  children, 
  variant = 'primary', 
  fullWidth = false, 
  className = '', 
  ...props 
}: ButtonProps) => {
  const baseStyles = 'inline-flex items-center justify-center font-medium transition-colors focus:outline-none';
  
  const variants = {
    primary: 'px-6 py-2 rounded-full border border-green-500 text-green-600 hover:bg-green-50 disabled:opacity-50 disabled:cursor-not-allowed',
    outline: 'px-6 py-1.5 text-[13px] border border-green-500 text-green-600 rounded-full hover:bg-green-50 disabled:opacity-50 disabled:cursor-not-allowed',
    ghost: 'px-3 py-1.5 text-xs bg-green-50 text-green-700 hover:bg-green-100 rounded-md border border-green-200'
  };

  const widthStyle = fullWidth ? 'w-full' : '';

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${widthStyle} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
