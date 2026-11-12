import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Button } from './Button';
import { ConfirmDialog, Dialog, Drawer } from './Dialog';

function ControlledDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>טיול חדש</Button>
      <Dialog open={open} onOpenChange={setOpen} title="יצירת טיול">
        <input aria-label="שם הטיול" />
      </Dialog>
    </>
  );
}

function ControlledConfirm() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>מחיקה</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title="למחוק?" onConfirm={() => undefined} />
    </>
  );
}

function ControlledDrawer() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>פתיחת תפריט</Button>
      <Drawer open={open} onOpenChange={setOpen} title="תפריט" showCloseButton>
        <a href="#x">קישור</a>
      </Drawer>
    </>
  );
}

describe('Dialog focus return (controlled, no trigger)', () => {
  it('returns focus to the opener after Escape', async () => {
    const user = userEvent.setup();
    render(<ControlledDialog />);
    const opener = screen.getByRole('button', { name: 'טיול חדש' });
    await user.click(opener);
    expect(await screen.findByRole('dialog', { name: 'יצירת טיול' })).toBeInTheDocument();
    await waitFor(() => expect(opener).not.toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('returns focus to the opener after the close button', async () => {
    const user = userEvent.setup();
    render(<ControlledDialog />);
    const opener = screen.getByRole('button', { name: 'טיול חדש' });
    await user.click(opener);
    await user.click(await screen.findByRole('button', { name: 'סגירה' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('ConfirmDialog returns focus to the opener on cancel', async () => {
    const user = userEvent.setup();
    render(<ControlledConfirm />);
    const opener = screen.getByRole('button', { name: 'מחיקה' });
    await user.click(opener);
    await user.click(await screen.findByRole('button', { name: 'ביטול' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('Drawer returns focus to the opener after Escape', async () => {
    const user = userEvent.setup();
    render(<ControlledDrawer />);
    const opener = screen.getByRole('button', { name: 'פתיחת תפריט' });
    await user.click(opener);
    expect(await screen.findByRole('dialog', { name: 'תפריט' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('keeps Radix behaviour when a trigger is used', async () => {
    const user = userEvent.setup();
    render(<Dialog trigger={<button type="button">פתיחה</button>} title="כותרת" />);
    const trigger = screen.getByRole('button', { name: 'פתיחה' });
    await user.click(trigger);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
