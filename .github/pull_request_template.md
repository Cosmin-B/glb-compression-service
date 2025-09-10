# Pull Request

## Description

Please include a summary of the changes and the related issue. List any dependencies that are required for this change.

Fixes # (issue)

## Type of Change

Please delete options that are not relevant.

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] This change requires a documentation update

## Testing

Please describe the tests that you ran to verify your changes. Provide instructions so we can reproduce.

- [ ] Health check endpoint (`/health`)
- [ ] Mesh compression endpoint (`/compress/mesh`)
- [ ] Texture compression endpoint (`/compress/textures`) 
- [ ] Full compression endpoint (`/compress/full`)
- [ ] Individual texture endpoints
- [ ] Docker build and run
- [ ] All existing functionality still works

### Test Configuration

- Node.js version:
- Operating System:
- Docker version (if applicable):

## Checklist

- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] Any dependent changes have been merged and published in downstream modules
- [ ] I have checked my code and corrected any misspellings

## API Changes

If this PR introduces API changes, please document them:

### New Endpoints
- [ ] None

### Modified Endpoints  
- [ ] None

### Breaking Changes
- [ ] None

## Performance Impact

Please describe any performance implications:

- [ ] No performance impact
- [ ] Improves performance
- [ ] May impact performance (explain below)

## Screenshots (if applicable)

Add screenshots to help explain your changes.

## Additional Context

Add any other context about the pull request here.

---

## For Reviewers

### Review Checklist

- [ ] Code quality and style
- [ ] Functionality works as described  
- [ ] No breaking changes introduced
- [ ] Documentation is updated
- [ ] Security considerations addressed
- [ ] Performance implications considered