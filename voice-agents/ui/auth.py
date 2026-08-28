"""JWT Authentication for OmniRoute Control Room.

Provides:
- Password hashing with SHA-256 + salt
- JWT token generation/validation
- User management (in-memory for now, can be extended to DB)
- FastAPI dependencies for protected endpoints
"""
import hashlib
import os
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from pydantic import BaseModel

# Configuration
SECRET_KEY = os.environ.get("UI_AUTH_SECRET", secrets.token_urlsafe(32))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("UI_TOKEN_EXPIRE_MINUTES", "1440"))  # 24h default

# OAuth2 scheme
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

# User storage (in-memory, can be extended to database)
_users: dict[str, dict] = {}


class User(BaseModel):
    username: str
    email: Optional[str] = None
    disabled: bool = False


class UserInDB(User):
    hashed_password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    username: Optional[str] = None


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    # Format: salt:hash
    if ":" not in hashed_password:
        return False
    salt, stored_hash = hashed_password.split(":", 1)
    computed_hash = hashlib.sha256((salt + plain_password).encode()).hexdigest()
    return computed_hash == stored_hash


def get_password_hash(password: str) -> str:
    """Hash a password with salt."""
    salt = secrets.token_hex(16)
    hashed = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"{salt}:{hashed}"


def get_user(username: str) -> Optional[UserInDB]:
    """Get a user by username."""
    if username in _users:
        return UserInDB(**_users[username])
    return None


def create_user(username: str, password: str, email: Optional[str] = None) -> User:
    """Create a new user."""
    if username in _users:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    
    hashed_password = get_password_hash(password)
    user_dict = {
        "username": username,
        "email": email,
        "disabled": False,
        "hashed_password": hashed_password
    }
    _users[username] = user_dict
    return User(username=username, email=email, disabled=False)


def authenticate_user(username: str, password: str) -> Optional[UserInDB]:
    """Authenticate a user with username and password."""
    user = get_user(username)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(token: Optional[str] = Depends(oauth2_scheme)) -> Optional[User]:
    """Get the current user from the JWT token.
    
    Returns None if no token is provided (for optional auth).
    Raises HTTPException if token is invalid.
    """
    if token is None:
        return None
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            return None
        token_data = TokenData(username=username)
    except JWTError:
        return None
    
    user = get_user(username=token_data.username)
    if user is None:
        return None
    if user.disabled:
        return None
    return User(username=user.username, email=user.email, disabled=user.disabled)


async def require_auth(user: Optional[User] = Depends(get_current_user)) -> User:
    """Require authentication - raises 401 if not authenticated."""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def init_default_user():
    """Initialize default admin user if no users exist."""
    if not _users:
        username = os.environ.get("UI_AUTH_USERNAME", "admin")
        password = os.environ.get("UI_AUTH_PASSWORD", "admin")
        email = os.environ.get("UI_AUTH_EMAIL", "admin@omniroute.local")
        create_user(username, password, email)
        print(f"[Auth] Default user created: {username}")
