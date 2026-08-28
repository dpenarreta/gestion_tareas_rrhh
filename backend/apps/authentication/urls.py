from django.urls import path

from .views import (
    AcceptConsentView,
    ChangeOwnPasswordView,
    LoginView,
    LogoutAllView,
    LogoutView,
    MeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RefreshView,
    RegisterView,
    SessionListView,
)

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("login/", LoginView.as_view(), name="login"),
    path("token/refresh/", RefreshView.as_view(), name="token_refresh"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("logout-all/", LogoutAllView.as_view(), name="logout_all"),
    path("sessions/", SessionListView.as_view(), name="sessions"),
    path("me/", MeView.as_view(), name="me"),
    path(
        "password-reset/request/", PasswordResetRequestView.as_view(), name="password_reset_request"
    ),
    path(
        "password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password_reset_confirm"
    ),
    path("password/change/", ChangeOwnPasswordView.as_view(), name="change_password"),
    path("consent/", AcceptConsentView.as_view(), name="accept_consent"),
]
