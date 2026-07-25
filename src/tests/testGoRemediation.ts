import { describe, it } from 'node:test';
import assert from 'node:assert';
import { applyBlockReplacement } from '@/agent/workers/patchWorker';

describe('🐹 Aegis End-to-End Go Repository Remediation Suite', () => {
  const originalGoFileContent = `package helpers

import (
	"errors"
	"fmt"
)

type UserSession struct {
	ID    string
	Token *string
}

// AuthenticateRequest validates user session token from incoming RPC request
func AuthenticateRequest(session *UserSession) error {
	if session == nil {
		return errors.New("invalid session")
	}
	// BUG: nil pointer dereference if session.Token is nil
	if *session.Token == "" {
		return errors.New("empty authentication token")
	}
	return nil
}
`;

  it('should apply precision block patch with exact indentation matching', () => {
    const targetBlock = `	// BUG: nil pointer dereference if session.Token is nil
	if *session.Token == "" {
		return errors.New("empty authentication token")
	}`;

    const replacementBlock = `	// REMEDIATED: check for nil token pointer before dereference
	if session.Token == nil || *session.Token == "" {
		return errors.New("empty or missing authentication token")
	}`;

    const patchedContent = applyBlockReplacement(originalGoFileContent, targetBlock, replacementBlock);
    assert.ok(patchedContent !== null, 'Patch should apply successfully');
    assert.ok(patchedContent.includes('session.Token == nil || *session.Token == ""'), 'Patched content should contain defensive nil check');
    assert.ok(!patchedContent.includes('// BUG: nil pointer dereference'), 'Bug comment should be removed');
  });

  it('should apply resilient block patch when LLM target block uses spaces instead of tabs', () => {
    // LLM sometimes outputs spaces even when source file uses tabs
    const targetBlockWithSpaces = `    // BUG: nil pointer dereference if session.Token is nil
    if *session.Token == "" {
        return errors.New("empty authentication token")
    }`;

    const replacementBlock = `	// REMEDIATED: check for nil token pointer before dereference
	if session.Token == nil || *session.Token == "" {
		return errors.New("empty or missing authentication token")
	}`;

    const patchedContent = applyBlockReplacement(originalGoFileContent, targetBlockWithSpaces, replacementBlock);
    assert.ok(patchedContent !== null, 'Resilient patch should apply even with tab/space differences');
    assert.ok(patchedContent.includes('session.Token == nil || *session.Token == ""'));
  });

  it('should return null when target block does not exist in file', () => {
    const nonExistentBlock = `func NonExistentFunction() error {
	return nil
}`;
    const patchedContent = applyBlockReplacement(originalGoFileContent, nonExistentBlock, '// replaced');
    assert.strictEqual(patchedContent, null, 'Should return null for non-matching target block');
  });
});
