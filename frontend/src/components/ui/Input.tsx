import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
}

export const Input = ({ icon, className = '', ...props }: InputProps) => {
  return (
    <div className="relative">
      <input 
        className={`w-full border border-gray-200 rounded-md px-3 py-2.5 text-sm text-gray-700 outline-none focus:border-green-500 bg-transparent placeholder-gray-400 ${icon ? 'pr-10' : ''} ${className}`}
        {...props}
      />
      {icon && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
          {icon}
        </div>
      )}
    </div>
  );
};
