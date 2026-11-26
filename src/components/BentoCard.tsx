import React from 'react';
import { motion, useMotionTemplate, useMotionValue } from 'framer-motion';
import { cn } from '../lib/format';

interface BentoCardProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

export const BentoCard: React.FC<BentoCardProps> = ({
  children,
  className,
  delay = 0,
}) => {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const { left, top } = e.currentTarget.getBoundingClientRect();
    mouseX.set(e.clientX - left);
    mouseY.set(e.clientY - top);
  }

  const spotlight = useMotionTemplate`radial-gradient(520px circle at ${mouseX}px ${mouseY}px, rgba(255, 255, 255, 0.055), transparent 65%)`;

  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 14, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        type: 'spring',
        stiffness: 360,
        damping: 32,
        delay,
      }}
      onMouseMove={handleMouseMove}
      className={cn(
        'group relative overflow-hidden rounded-[22px] bg-[#0A0A0D]/95 border border-white/10 shadow-bento transition-colors duration-300 hover:border-white/[0.16]',
        className
      )}
    >
      {/* Interactive cursor spotlight sheen */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-px rounded-[22px] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: spotlight }}
      />

      {/* Top hairline specular edge */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
      />

      <div className="relative z-10 flex h-full flex-col">{children}</div>
    </motion.section>
  );
};
