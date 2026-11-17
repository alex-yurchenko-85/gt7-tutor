import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiStub, renderApp, setViewportWidth, signedIn } from './support.tsx';

describe('shell', () => {
  it('desktop_has_top_navigation_and_phone_has_bottom_navigation', async () => {
    signedIn(new ApiStub()).install();
    setViewportWidth(1280);
    const desktop = renderApp();
    const top = await screen.findByRole('navigation', { name: 'Main' });
    expect(top).toHaveAttribute('data-placement', 'top');
    expect(top.closest('header')).not.toBeNull();
    expect(screen.getByText('Voice not ready')).toBeInTheDocument();
    desktop.unmount();

    setViewportWidth(390);
    renderApp();
    const bottom = await screen.findByRole('navigation', { name: 'Main' });
    expect(bottom).toHaveAttribute('data-placement', 'bottom');
    expect(bottom.closest('header')).toBeNull();
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(expect.arrayContaining(['Now', 'Catalogue', 'Drive', 'Progress', 'Setup']));
  });
});
