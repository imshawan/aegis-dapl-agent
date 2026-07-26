import React from 'react';

export const AsciiBanner: React.FC = () => {
  const bannerText = `     /\\        _______ _______ _______ _______ 
    /  \\      |   ____|   ____|_     _|   ____|
   / /\\ \\     |  |____|  |  __  |   | |  |____ 
  / /__\\ \\    |   ____|  | |_ | |   | |_____  |
 / /____\\ \\   |  |____|  |__| | |___|  ____|  |
/_/      \\_\\  |_______|_______|_____| |_______|`;

  return <div className="ascii-art">{bannerText}</div>;
};
