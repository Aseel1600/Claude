import { logger } from '../logger';
import { request } from '../request';

const IS_WINDOWS = process.platform === 'win32';

export async function patchApiCombosId(id, body) {
  logger.info(`Patching combo with ID: ${id}`);
  // The API documentation states PATCH, but the server responds with 405.
  // Based on observation and common REST practices, PUT is often used for full updates,
  // and PATCH for partial updates. If the server only supports PUT for updates,
  // we should use PUT here. However, the issue also states the ID is not substituted.
  // We will assume the intent was to update and use PUT, and ensure ID substitution.
  // If PATCH is truly intended and supported by a different endpoint or mechanism,
  // this would need further clarification.

  const url = `/api/combos/${id}`;
  try {
    const response = await request('PUT', url, body);
    logger.info(`Successfully patched combo ${id}`);
    return response;
  } catch (error) {
    logger.error(`Failed to patch combo ${id}: ${error.message}`);
    throw error;
  }
}

export async function deleteApiCombosId(id) {
  logger.info(`Deleting combo with ID: ${id}`);
  const url = `/api/combos/${id}`;
  try {
    const response = await request('DELETE', url, null);
    logger.info(`Successfully deleted combo ${id}`);
    return response;
  } catch (error) {
    logger.error(`Failed to delete combo ${id}: ${error.message}`);
    throw error;
  }
}
