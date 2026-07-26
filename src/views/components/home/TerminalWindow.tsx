import React, { ReactNode } from 'react';

export interface TerminalWindowProps {
  title?: string;
  loginText?: string;
  isAuthorized?: boolean;
  children?: ReactNode;
}

export const TerminalWindow: React.FC<TerminalWindowProps> = ({
  children,
}) => {
  return <div className="terminal-box">{children}</div>;
};
