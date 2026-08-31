import chalk from 'chalk';

export type MessageSection = 'thinking' | 'text';

let currentSection: MessageSection | null = null;

export const terminalColor = {
  thinking: chalk.magenta.bold,
  toolCall: chalk.yellow.bold,
  input: chalk.cyan.bold,
  output: chalk.blue.bold,
  toolEvent: chalk.gray.bold,
  finalAnswer: chalk.green.bold,
  error: chalk.red.bold,
};

export const writeMessageChunk = (
  section: MessageSection,
  title: string,
  content: string,
) => {
  if (!content) return;

  if (currentSection !== section) {
    const colorTitle =
      section === 'thinking'
        ? terminalColor.thinking(title)
        : terminalColor.finalAnswer(title);

    process.stdout.write(`${currentSection ? '\n\n' : ''}${colorTitle}\n`);
    currentSection = section;
  }

  process.stdout.write(content);
};

export const resetMessageSection = () => {
  currentSection = null;
};

export const formatValue = (value: unknown): string => {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  if (value && typeof value === 'object' && 'content' in value) {
    return formatValue(value.content);
  }

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
};

const loadingFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const createLoading = (defaultMessage = '正在等待响应...') => {
  let active = false;
  let frameIndex = 0;
  let message = defaultMessage;
  let timer: ReturnType<typeof setInterval> | undefined;

  const render = () => {
    const frame = loadingFrames[frameIndex] ?? loadingFrames[0];
    process.stdout.write(`\r${chalk.cyan(frame)} ${chalk.dim(message)}`);
    frameIndex = (frameIndex + 1) % loadingFrames.length;
  };

  const stop = () => {
    if (!active) return;

    active = false;
    if (timer) clearInterval(timer);
    timer = undefined;

    if (process.stdout.isTTY) {
      process.stdout.write('\r\x1b[2K');
    }
  };

  const start = (nextMessage = defaultMessage) => {
    if (active) stop();

    active = true;
    message = nextMessage;
    frameIndex = 0;

    if (!process.stdout.isTTY) {
      process.stdout.write(`${chalk.cyan('⏳')} ${chalk.dim(message)}\n`);
      return;
    }

    render();
    timer = setInterval(render, 80);
    timer.unref();
  };

  return { start, stop };
};
