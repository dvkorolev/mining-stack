import { useMediaQuery, useTheme } from '@mui/material';

/**
 * Custom hook to detect if the current viewport is mobile-sized
 * Returns true for screens smaller than 'md' breakpoint (960px)
 */
export const useIsMobile = (): boolean => {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down('md'));
};

export default useIsMobile;
