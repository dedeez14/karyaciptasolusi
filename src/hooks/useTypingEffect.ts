import { useState, useEffect } from 'react';

export function useTypingEffect(
  texts: string[],
  typingSpeed = 80,
  deleteSpeed = 40,
  pauseBetween = 2000
) {
  const [displayedText, setDisplayedText] = useState('');
  const [textIndex, setTextIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const currentText = texts[textIndex];
    let timeout: ReturnType<typeof setTimeout>;

    if (isPaused) {
      timeout = setTimeout(() => {
        setIsPaused(false);
        setIsDeleting(true);
      }, pauseBetween);
      return () => clearTimeout(timeout);
    }

    if (isDeleting) {
      if (displayedText === '') {
        setIsDeleting(false);
        setTextIndex((prev) => (prev + 1) % texts.length);
      } else {
        timeout = setTimeout(() => {
          setDisplayedText(currentText.slice(0, displayedText.length - 1));
        }, deleteSpeed);
      }
    } else {
      if (displayedText === currentText) {
        setIsPaused(true);
      } else {
        timeout = setTimeout(() => {
          setDisplayedText(currentText.slice(0, displayedText.length + 1));
        }, typingSpeed);
      }
    }

    return () => clearTimeout(timeout);
  }, [displayedText, textIndex, isDeleting, isPaused, texts, typingSpeed, deleteSpeed, pauseBetween]);

  return displayedText;
}
