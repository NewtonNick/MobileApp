import { Meta } from '@/ui/primitives';

/** Calculator copy. Not a recommendation to buy, sell, or borrow. */
export function NotAdviceNote({ extra }: { extra?: string }) {
  return (
    <Meta>
      These figures are a calculator for the numbers you typed. They are not financial, tax, or legal advice.
      {extra ? ` ${extra}` : ''}
    </Meta>
  );
}
